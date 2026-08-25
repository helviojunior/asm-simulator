"""Testes da biblioteca: metadata por arquivo, fonte em disco e bundle."""

import io
import json
import tarfile

import yaml
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase

from asm_simulator.models import LibraryNode
from asm_simulator.services import library_storage

JSON = 'application/json'


class LibraryTestCase(TransactionTestCase):
    """Base com os atalhos que todos os testes daqui usam.

    `TransactionTestCase`, e nao `TestCase`: a gravacao e a remocao do `.asm`
    acontecem em `transaction.on_commit` (para o disco nunca ficar a frente do
    banco num rollback). O `TestCase` envolve cada teste numa transacao que
    nunca commita, entao esses callbacks jamais rodariam e o teste mediria o
    contrario do que o codigo faz.
    """

    def setUp(self):
        # Retrato do que ja havia em disco. Os testes comparam contra ELE em vez
        # de limpar o diretorio: `DATA_DIR` pode apontar para o volume real de
        # quem rodar a suite dentro do container em uso, e apagar ali levaria a
        # biblioteca do aluno junto.
        self._files_before = set(library_storage.library_dir().glob('*.asm'))

    def tearDown(self):
        # O fonte vive FORA do banco: o rollback do TestCase nao o remove, e um
        # `.asm` deixado para tras contaminaria o teste seguinte.
        for node in LibraryNode.objects.all():
            library_storage.delete_source(node.pk)

    def post(self, url, payload):
        return self.client.post(url, data=json.dumps(payload), content_type=JSON)

    def patch(self, url, payload):
        return self.client.patch(url, data=json.dumps(payload), content_type=JSON)

    def make_file(self, name, source='nop\n', parent=None, **metadata):
        payload = {'kind': 'file', 'name': name, 'source': source}
        if parent:
            payload['parent'] = parent
        if metadata:
            payload['metadata'] = metadata
        response = self.post('/api/library/', payload)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def make_folder(self, name, parent=None):
        payload = {'kind': 'folder', 'name': name}
        if parent:
            payload['parent'] = parent
        response = self.post('/api/library/', payload)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()


class SourceStorageTests(LibraryTestCase):
    """O fonte mora em <DATA_DIR>/library/<uuid>.asm, nao no banco."""

    def test_source_goes_to_disk_named_by_uuid(self):
        node = self.make_file('a.asm', source='mov eax, 1\n')
        path = library_storage.source_path(node['id'])

        self.assertTrue(path.exists())
        self.assertEqual(path.name, f"{node['id']}.asm")
        self.assertEqual(path.read_text(), 'mov eax, 1\n')
        # `source` deixou de ser coluna.
        self.assertNotIn('source', [f.name for f in LibraryNode._meta.get_fields()])

    def test_listing_omits_source_and_detail_includes_it(self):
        node = self.make_file('a.asm', source='mov eax, 1\n')

        row = next(n for n in self.client.get('/api/library/').json()['nodes']
                   if n['id'] == node['id'])
        self.assertNotIn('source', row)

        detail = self.client.get(f"/api/library/{node['id']}/").json()
        self.assertEqual(detail['source'], 'mov eax, 1\n')

    def test_empty_file_round_trips_as_empty(self):
        node = self.make_file('vazio.asm', source='')
        self.assertEqual(self.client.get(f"/api/library/{node['id']}/").json()['source'], '')

    def test_deleting_a_folder_removes_the_files_on_disk(self):
        folder = self.make_folder('aula')
        node = self.make_file('a.asm', parent=folder['id'])
        path = library_storage.source_path(node['id'])

        self.assertEqual(self.client.delete(f"/api/library/{folder['id']}/").status_code, 204)
        self.assertFalse(path.exists())


class MetadataTests(LibraryTestCase):
    """Parametros de execucao sao por arquivo."""

    def test_metadata_round_trip_and_partial_patch(self):
        node = self.make_file('a.asm', arch='x86_64', code_base='0x400000',
                              stack_top='0x800000', arg_count=6)
        self.assertEqual(node['metadata'], {
            'arch': 'x86_64', 'code_base': '0x400000',
            'stack_top': '0x800000', 'arg_count': 6,
        })

        # PATCH parcial nao zera o resto.
        response = self.patch(f"/api/library/{node['id']}/", {'metadata': {'arg_count': 2}})
        self.assertEqual(response.json()['metadata'], {
            'arch': 'x86_64', 'code_base': '0x400000',
            'stack_top': '0x800000', 'arg_count': 2,
        })

    def test_folders_have_no_metadata(self):
        self.assertIsNone(self.make_folder('aula')['metadata'])

    def test_invalid_metadata_is_refused(self):
        node = self.make_file('a.asm')
        for bad in ({'arch': 'arm'}, {'code_base': 'nao-e-numero'}, {'arg_count': 99}):
            with self.subTest(bad=bad):
                response = self.patch(f"/api/library/{node['id']}/", {'metadata': bad})
                self.assertEqual(response.status_code, 400, response.content)


class MoveTests(LibraryTestCase):
    def test_move_into_folder(self):
        folder = self.make_folder('aula')
        node = self.make_file('a.asm')
        response = self.patch(f"/api/library/{node['id']}/", {'parent': folder['id']})
        self.assertEqual(response.json()['parent'], folder['id'])

    def test_folder_cannot_move_into_itself(self):
        folder = self.make_folder('aula')
        response = self.patch(f"/api/library/{folder['id']}/", {'parent': folder['id']})
        self.assertEqual(response.status_code, 400)


class BundleTests(LibraryTestCase):
    """Export/import no formato .scasmlib (tar.gz com nomes UUID)."""

    def setUp(self):
        super().setUp()
        self.folder = self.make_folder('Sec4US Shellcoding')
        self.sub = self.make_folder('x64', parent=self.folder['id'])
        self.file = self.make_file(
            'teste001.asm', source='bits 64\nmov rax, 59\nsyscall\n', parent=self.sub['id'],
            arch='x86_64', code_base='0x400000', stack_top='0x80C000', arg_count=6)

    def export(self):
        response = self.client.get('/api/library/export/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response['Content-Type'], 'application/gzip')
        self.assertIn('library.scasmlib', response['Content-Disposition'])
        return response.content

    def upload(self, blob, parent=None):
        payload = {'file': SimpleUploadedFile('library.scasmlib', blob,
                                              content_type='application/gzip')}
        if parent:
            payload['parent'] = parent
        return self.client.post('/api/library/import/', payload)

    def test_archive_mirrors_the_tree_with_uuid_names(self):
        with tarfile.open(fileobj=io.BytesIO(self.export()), mode='r:gz') as tar:
            names = set(tar.getnames())

            # Um .yaml por no, no mesmo diretorio do conteudo; .asm so em arquivo.
            self.assertIn('scasmlib.yaml', names)
            self.assertIn(f"{self.folder['id']}.yaml", names)
            self.assertIn(f"{self.folder['id']}/{self.sub['id']}.yaml", names)
            path = f"{self.folder['id']}/{self.sub['id']}/{self.file['id']}"
            self.assertIn(f'{path}.yaml', names)
            self.assertIn(f'{path}.asm', names)
            self.assertNotIn(f"{self.folder['id']}.asm", names)

            meta = yaml.safe_load(tar.extractfile(f'{path}.yaml').read())
            self.assertEqual(meta['name'], 'teste001.asm')
            self.assertEqual(meta['kind'], 'file')
            self.assertEqual(meta['parent'], self.sub['id'])
            self.assertEqual(meta['metadata']['arch'], 'x86_64')
            self.assertEqual(tar.extractfile(f'{path}.asm').read().decode(),
                             'bits 64\nmov rax, 59\nsyscall\n')

    def test_import_into_a_folder_rebuilds_the_tree_with_new_ids(self):
        blob = self.export()
        destination = self.make_folder('importado')

        response = self.upload(blob, parent=destination['id'])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['imported'], 3)

        folder = LibraryNode.objects.get(parent__id=destination['id'],
                                         name='Sec4US Shellcoding')
        sub = LibraryNode.objects.get(parent=folder, name='x64')
        node = LibraryNode.objects.get(parent=sub, name='teste001.asm')

        # Ids sao NOVOS: o bundle pode voltar para a instancia de onde saiu.
        self.assertNotEqual(str(node.id), self.file['id'])
        self.assertEqual(node.source, 'bits 64\nmov rax, 59\nsyscall\n')
        self.assertEqual(node.arch, 'x86_64')
        self.assertEqual(node.code_base, '0x400000')
        self.assertEqual(node.arg_count, 6)

    def test_import_never_overwrites_a_colliding_name(self):
        blob = self.export()
        self.assertEqual(self.upload(blob).status_code, 201)

        roots = set(LibraryNode.objects.filter(parent__isnull=True)
                    .values_list('name', flat=True))
        self.assertIn('Sec4US Shellcoding', roots)
        self.assertIn('Sec4US Shellcoding (2)', roots)

    def test_bad_uploads_are_refused(self):
        self.assertEqual(self.client.post('/api/library/import/', {}).status_code, 400)
        self.assertEqual(self.upload(b'nao sou um tar').status_code, 400)

    def test_import_leaves_no_orphan_files_on_disk(self):
        self.upload(self.export())

        owned = {str(i) for i in LibraryNode.objects.values_list('id', flat=True)}
        written = set(library_storage.library_dir().glob('*.asm')) - self._files_before
        orphans = sorted(p.name for p in written if p.stem not in owned)
        self.assertEqual(orphans, [])

"""Testes da biblioteca: metadata por arquivo, fonte em disco e bundle."""

import base64
import io
import json
import tarfile

import yaml
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase

from asm_simulator.models import LibraryNode
from asm_simulator.services import library_storage
from asm_simulator.services.assembler import AssemblyError, assemble
from asm_simulator.services.disassembler import analyze, disassemble

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
        node = self.make_file('a.asm', arch='x86_64', os='macos', code_base='0x400000',
                              stack_top='0x800000', arg_count=6)
        self.assertEqual(node['metadata'], {
            'arch': 'x86_64', 'os': 'macos', 'code_base': '0x400000',
            'stack_top': '0x800000', 'arg_count': 6,
        })

        # PATCH parcial nao zera o resto.
        response = self.patch(f"/api/library/{node['id']}/", {'metadata': {'arg_count': 2}})
        self.assertEqual(response.json()['metadata'], {
            'arch': 'x86_64', 'os': 'macos', 'code_base': '0x400000',
            'stack_top': '0x800000', 'arg_count': 2,
        })

    def test_target_system_is_optional_and_validated(self):
        # Vazio: arquivo salvo antes de o alvo ser resolvido.
        self.assertEqual(self.make_file('sem-alvo.asm')['metadata']['os'], '')

        node = self.make_file('com-alvo.asm', os='windows')
        self.assertEqual(node['metadata']['os'], 'windows')

        bad = self.patch(f"/api/library/{node['id']}/", {'metadata': {'os': 'plan9'}})
        self.assertEqual(bad.status_code, 400, bad.content)

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
            arch='x86_64', os='linux', code_base='0x400000', stack_top='0x80C000', arg_count=6)

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
            self.assertEqual(meta['metadata']['os'], 'linux')
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
        self.assertEqual(node.os, 'linux')
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


class DataDirectiveTests(TransactionTestCase):
    """`db` e familia nao podem ser lidos como instrucao.

    Os bytes de "/bin/sh" FORMAM instrucoes validas (`6E` e `outsb`, `73 68` e
    `jae`), entao o `skipdata` do Capstone nao ajuda: ele so age quando os
    bytes nao decodificam. Quem sabe o que e dado e o montador, pelo listing.
    """

    def build(self, source, arch='x86_64'):
        built = assemble(source, arch=arch, base_address=0x400000)
        data, line_map, ranges = built.data, built.line_map, built.data_ranges
        return disassemble(data, arch=arch, base_address=0x400000,
                           line_map=line_map, data_ranges=ranges), ranges

    def data_rows(self, instructions):
        return [i for i in instructions if i['data']]

    def test_embedded_string_stays_data(self):
        # A tecnica JMP-CALL-POP, com a string logo depois do `call`.
        instructions, ranges = self.build(
            '[BITS 64]\n'
            '    jmp step1\n'
            'step2:\n'
            '    pop rdi\n'
            '    xor rax, rax\n'
            '    mov al, 59\n'
            '    syscall\n'
            'step1:\n'
            '    call step2\n'
            '    db "/bin/sh", 0x01\n'
        )
        self.assertEqual(ranges, [(15, 23)])

        rows = self.data_rows(instructions)
        self.assertEqual(len(rows), 1, 'a string deve virar UMA linha de dados')
        self.assertEqual(rows[0]['bytes'], '2F 62 69 6E 2F 73 68 01')

        # E nada dela pode ter virado instrucao.
        decoded = ' '.join(i['text'] for i in instructions if not i['data'])
        for ghost in ('outsb', 'jae', 'outsd'):
            self.assertNotIn(ghost, decoded)

    def test_label_before_the_directive_still_counts(self):
        instructions, ranges = self.build(
            '[BITS 64]\n'
            '    jmp shell\n'
            'command:\n'
            '    db "notepad.exe", 0x01\n'
            'shell:\n'
            '    nop\n'
        )
        self.assertEqual(ranges, [(2, 14)])
        self.assertEqual(self.data_rows(instructions)[0]['bytes'],
                         '6E 6F 74 65 70 61 64 2E 65 78 65 01')

    def test_times_and_word_directives(self):
        # `times` sai do listing como `90<rep 4h>`: os bytes repetidos nao
        # aparecem, entao o tamanho vem do offset da proxima linha.
        instructions, ranges = self.build(
            '[BITS 32]\n'
            '    nop\n'
            'buf:\n'
            '    times 4 db 0x90\n'
            '    dw 0x1234\n'
            '    nop\n',
            arch='x86',
        )
        self.assertEqual(ranges, [(1, 7)])
        self.assertEqual(self.data_rows(instructions)[0]['bytes'], '90 90 90 90 34 12')

    def test_a_comment_is_not_a_directive(self):
        instructions, ranges = self.build('[BITS 64]\n; db "nao sou dado"\n    nop\n')
        self.assertEqual(ranges, [])
        self.assertEqual(self.data_rows(instructions), [])

    def test_code_without_data_is_untouched(self):
        instructions, ranges = self.build('[BITS 64]\n    xor rax, rax\n    syscall\n')
        self.assertEqual(ranges, [])
        self.assertEqual([i['mnemonic'] for i in instructions], ['xor', 'syscall'])


class SectionTests(TransactionTestCase):
    """Só existem `.text` e `.data` — e `.data` existe sempre.

    O simulador nao tem carregador: o binario e uma imagem contigua escrita em
    `codeBase`, com a pilha ao lado. `.bss` nao seria reservada nem zerada, e
    `.rodata` nao teria protecao de escrita; aceitar essas secoes ensinaria uma
    semantica que nao existe aqui.
    """

    BASE = 0x7FF700001000

    # O exemplo canonico: `.data` declarada ANTES de `.text`, com um tipo de
    # dado por tamanho, e o codigo alcancando a string por RIP-relativo.
    SOURCE = (
        '[BITS 64]\n'
        '\n'
        'section .data\n'
        '    msg     db      "Hello, World!", 0Ah\n'
        '    age     db      25\n'
        '    count   dw      1000\n'
        '    id_num  dd      12345678\n'
        '    large   dq      123456789012345\n'
        '\n'
        'global _start\n'
        'section .text\n'
        '\n'
        '_start:\n'
        '    push rbp\n'
        '    mov rbp, rsp\n'
        '    lea rcx, [rel msg]\n'
        '    call Function1\n'
        '    pop rbp\n'
        '    ret\n'
        '\n'
        'Function1:\n'
        '    nop\n'
        '    nop\n'
        '    ret\n'
    )

    def build(self, source=None, arch='x86_64'):
        return assemble(source or self.SOURCE, arch=arch, base_address=self.BASE)

    def section(self, built, name):
        return next(item for item in built.sections if item['name'] == name)

    # -- o que e recusado ---------------------------------------------------

    def test_bss_is_refused_pointing_at_the_line(self):
        with self.assertRaises(AssemblyError) as ctx:
            assemble('[BITS 64]\nsection .bss\n    buf resb 64\n',
                     arch='x86_64', base_address=self.BASE)
        messages = ctx.exception.messages
        self.assertEqual([m['line'] for m in messages], [2])
        self.assertIn('.bss', messages[0]['message'])

    def test_rodata_is_refused(self):
        with self.assertRaises(AssemblyError):
            assemble('[BITS 64]\nsection .rodata\n k db 1\n',
                     arch='x86_64', base_address=self.BASE)

    def test_every_rejected_section_is_reported_at_once(self):
        # Corrigir uma por vez, com uma nova montagem a cada, seria trabalho
        # que o montador ja poderia ter poupado.
        with self.assertRaises(AssemblyError) as ctx:
            assemble('[BITS 64]\nsection .bss\n b resb 1\nsection .rodata\n k db 1\n',
                     arch='x86_64', base_address=self.BASE)
        self.assertEqual([m['line'] for m in ctx.exception.messages], [2, 4])

    def test_bracketed_and_segment_forms_are_caught_too(self):
        for source in ('[BITS 64]\n[section .bss]\n b resb 1\n',
                       '[BITS 64]\nsegment .rodata\n k db 1\n'):
            with self.assertRaises(AssemblyError):
                assemble(source, arch='x86_64', base_address=self.BASE)

    def test_a_commented_out_section_is_not_a_section(self):
        built = self.build('[BITS 64]\n; section .bss\n nop\n')
        self.assertEqual(len(built.data), 1)

    def test_text_and_data_are_accepted(self):
        built = self.build()
        self.assertEqual([item['name'] for item in built.sections], ['.text', '.data'])

    # -- a pseudo-secao -----------------------------------------------------

    def test_data_exists_even_when_the_source_has_none(self):
        # Vazia, mas na MESMA fronteira em que cairia se existisse. Assim
        # nenhum painel precisa tratar "programa sem .data" como caso a parte,
        # e o endereco que o atalho do dump mostra e o de sempre.
        built = self.build('[BITS 64]\n nop\n nop\n')
        data = self.section(built, '.data')
        self.assertEqual(data['start'], data['end'])
        self.assertEqual((self.BASE + data['start']) % 0x1000, 0)
        self.assertGreaterEqual(data['start'] - len(built.data), 500)

    # -- onde a `.data` cai -------------------------------------------------

    def test_data_starts_on_a_page_boundary(self):
        # Num programa de verdade a `.data` fica noutra pagina, e o endereco
        # dela termina em tres zeros. Colada ao fim do codigo, a fronteira
        # entre codigo e dado seria invisivel no dump.
        built = self.build()
        self.assertEqual((self.BASE + self.section(built, '.data')['start']) % 0x1000, 0)

    def test_there_is_room_between_the_code_and_the_data(self):
        built = self.build()
        text, data = self.section(built, '.text'), self.section(built, '.data')
        self.assertGreaterEqual(data['start'] - text['end'], 500)

    def test_a_text_that_fills_the_page_pushes_the_data_to_the_next(self):
        # Sem a folga minima, um `.text` que termina perto do fim da pagina
        # poria a `.data` a poucos bytes dele — endereco redondo e separacao
        # imperceptivel, que e o que a folga existe para impedir.
        filler = '[BITS 64]\nsection .text\n times 4000 nop\n' \
                 'section .data\n k db 1\n'
        built = self.build(filler)
        text, data = self.section(built, '.text'), self.section(built, '.data')
        self.assertGreaterEqual(data['start'] - text['end'], 500)
        self.assertEqual((self.BASE + data['start']) % 0x1000, 0)
        self.assertEqual(data['start'], 0x2000)

    def test_the_gap_is_a_single_line_in_the_disassembly(self):
        # Milhares de bytes zerados listados de 16 em 16 seriam centenas de
        # linhas entre o codigo e os dados. `times` e como o NASM escreveria.
        built = self.build()
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        text, data = self.section(built, '.text'), self.section(built, '.data')
        gap = [i for i in instructions
               if self.BASE + text['end'] <= int(i['address']) < self.BASE + data['start']]
        self.assertEqual(len(gap), 1)
        self.assertTrue(gap[0]['fill'])
        self.assertEqual(gap[0]['size'], data['start'] - text['end'])
        self.assertEqual(gap[0]['text'], f"times {gap[0]['size']} db 0x00")

    def test_declared_data_is_never_collapsed_into_a_fill(self):
        # A corrida de bytes iguais para na proxima linha do fonte: dois `db 0`
        # em linhas diferentes sao duas declaracoes.
        built = self.build(
            '[BITS 64]\nsection .text\n nop\n'
            'section .data\n a times 40 db 0\n b times 40 db 0\n'
        )
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        data = self.section(built, '.data')
        fills = [i for i in instructions
                 if i.get('fill') and int(i['address']) >= self.BASE + data['start']]
        self.assertEqual(len(fills), 2)
        self.assertEqual([i['size'] for i in fills], [40, 40])

    # -- o layout -----------------------------------------------------------

    def test_text_comes_first_and_data_after_it(self):
        built = self.build()
        text, data = self.section(built, '.text'), self.section(built, '.data')
        self.assertEqual(text['start'], 0)
        self.assertLessEqual(text['end'], data['start'])
        self.assertEqual(data['end'], len(built.data))

    def test_data_bytes_are_the_declared_ones(self):
        built = self.build()
        data = self.section(built, '.data')
        blob = built.data[data['start']:data['end']]
        self.assertTrue(blob.startswith(b'Hello, World!\n'))
        # 25 num byte, 1000 numa word, e o resto em little-endian.
        self.assertEqual(blob[14], 25)
        self.assertEqual(int.from_bytes(blob[15:17], 'little'), 1000)
        self.assertEqual(int.from_bytes(blob[17:21], 'little'), 12345678)
        self.assertEqual(int.from_bytes(blob[21:29], 'little'), 123456789012345)

    def test_rip_relative_reference_lands_on_the_data_section(self):
        # `lea rcx, [rel msg]` so aponta para o lugar certo se `.data` estiver
        # onde o montador disse que esta — e a prova de que o layout bate.
        built = self.build()
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        lea = next(i for i in instructions if i['mnemonic'] == 'lea')
        target = int(lea['address']) + int(lea['size']) + int(lea['operands'][1]['disp'])
        self.assertEqual(target, self.BASE + self.section(built, '.data')['start'])

    # -- o que o resto do sistema le ---------------------------------------

    def test_the_line_map_does_not_confuse_the_two_sections(self):
        # O listing do nasm conta o offset a partir do inicio de CADA secao,
        # entao o primeiro byte de `.text` e o primeiro de `.data` sao ambos
        # "offset 0". Sem a base de cada secao, um apagava o outro.
        built = self.build()
        first_code_line = self.SOURCE.splitlines().index('    push rbp') + 1
        self.assertEqual(built.line_map[0], first_code_line)

        data = self.section(built, '.data')
        msg_line = self.SOURCE.splitlines().index(
            '    msg     db      "Hello, World!", 0Ah') + 1
        self.assertEqual(built.line_map[data['start']], msg_line)

    def test_the_whole_data_section_is_marked_as_data(self):
        built = self.build()
        data = self.section(built, '.data')
        covered = any(start <= data['start'] and end >= data['end']
                      for start, end in built.data_ranges)
        self.assertTrue(covered, built.data_ranges)

    def test_padding_between_the_sections_is_not_decoded_as_code(self):
        # O nasm alinha `.data` em 4 bytes; os bytes de enchimento nao sao
        # instrucao, e desmontados virariam um `add [rax], al` sem fonte.
        built = self.build()
        text, data = self.section(built, '.text'), self.section(built, '.data')
        if text['end'] == data['start']:
            self.skipTest('sem enchimento neste programa')
        self.assertTrue(any(start <= text['end'] and end >= data['start']
                            for start, end in built.data_ranges))

    def test_data_is_not_disassembled_as_instructions(self):
        built = self.build()
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        start = self.BASE + self.section(built, '.data')['start']
        inside = [i for i in instructions if int(i['address']) >= start]
        self.assertTrue(inside)
        self.assertTrue(all(i['data'] for i in inside))

    def test_the_endpoint_reports_the_sections(self):
        response = self.client.post(
            '/api/program/assemble/',
            {'source': self.SOURCE, 'arch': 'x86_64', 'base_address': str(self.BASE)},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([s['name'] for s in response.json()['sections']],
                         ['.text', '.data'])

    def test_the_endpoint_reports_a_refused_section_on_its_line(self):
        response = self.client.post(
            '/api/program/assemble/',
            {'source': '[BITS 64]\nsection .bss\n b resb 1\n', 'arch': 'x86_64'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['messages'][0]['line'], 2)

    def test_a_rip_relative_access_keeps_its_source_line(self):
        # O nasm lista o deslocamento ainda nao resolvido entre parenteses
        # (`488D0D(00000000)`). Sem aceitar essa forma, a linha do listing era
        # descartada — e justamente a instrucao que le a variavel ficava sem
        # linha no editor.
        built = self.build()
        lea_line = self.SOURCE.splitlines().index('    lea rcx, [rel msg]') + 1
        self.assertIn(lea_line, built.line_map.values())

    def test_in_64_bits_a_label_is_reached_relative_to_rip(self):
        # O deslocamento absoluto cabe em 32 bits — e a base de um programa de
        # 64 bits nao. `mov rdx, [mydata]` pedia 0x00007FF700002000, o nasm
        # TRUNCAVA em silencio (sem erro, sem aviso) e a instrucao passava a
        # ler 0x2000: um endereco onde nao ha nada. Codigo x86-64 de verdade
        # enderereca dado em relacao ao RIP, e e o que o preambulo liga.
        source = (
            '[BITS 64]\n'
            'section .data\n'
            '    mydata dq 0x0807060504030201\n'
            'section .text\n'
            '    mov rdx, [mydata]\n'
        )
        built = self.build(source)
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        mov = instructions[0]
        memory = next(op for op in mov['operands'] if op['type'] == 'mem')
        self.assertEqual(memory['base'], 'rip')

        # E o endereco alcancado e a variavel, e nao os 32 bits de baixo dela.
        target = int(mov['address']) + int(mov['size']) + int(memory['disp'])
        self.assertEqual(target, self.BASE + self.section(built, '.data')['start'])

    def test_the_source_may_ask_for_absolute_addressing(self):
        # `default rel` e um padrao, nao uma imposicao: quem escreve `default
        # abs` esta estudando justamente a forma absoluta.
        source = (
            '[BITS 64]\n'
            'default abs\n'
            'section .data\n'
            '    mydata dq 0x0807060504030201\n'
            'section .text\n'
            '    mov rdx, [mydata]\n'
        )
        built = self.build(source)
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        memory = next(op for op in instructions[0]['operands'] if op['type'] == 'mem')
        self.assertIsNone(memory['base'])

    def test_an_absolute_access_to_a_label_keeps_its_source_line(self):
        # Em 32 bits o acesso a uma variavel e ABSOLUTO, e o nasm escreve o
        # endereco do rotulo entre colchetes no MEIO dos bytes:
        # `8B15[00000000]`, e `C705[04000000]0102-` quando ainda ha imediato
        # depois. Aceitar essas marcas so no fim da coluna descartava a linha
        # inteira — e a instrucao que le a variavel ficava sem marcacao no
        # editor, que e a leitura que liga o fonte ao codigo montado.
        source = (
            '[BITS 32]\n'
            'section .text\n'
            '    mov edx, [mydata]\n'
            '    mov [mydata2], dword 0x04030201\n'
            '    nop\n'
            'section .data\n'
            '    mydata  dd 0x04030201\n'
            '    mydata2 dd 0\n'
        )
        built = assemble(source, arch='x86', base_address=0x7F200100)
        self.assertEqual(built.line_map[0], 3)
        self.assertEqual(built.line_map[6], 4)

    def test_the_alignment_padding_is_a_range_of_its_own(self):
        # A desmontagem quebra dados em linhas de 16 bytes a partir do inicio
        # de CADA faixa. Fundido com a `.data`, o enchimento deslocaria a
        # primeira variavel para o meio da primeira linha do dump.
        built = self.build()
        text, data = self.section(built, '.text'), self.section(built, '.data')
        self.assertLess(text['end'], data['start'], 'este programa nao tem enchimento')
        self.assertIn((text['end'], data['start']), built.data_ranges)
        self.assertIn((data['start'], data['end']), built.data_ranges)

    def test_the_first_data_row_starts_on_the_first_variable(self):
        built = self.build()
        instructions = disassemble(built.data, arch='x86_64', base_address=self.BASE,
                                   line_map=built.line_map, data_ranges=built.data_ranges)
        data = self.section(built, '.data')
        first = next(i for i in instructions
                     if i['data'] and int(i['address']) == self.BASE + data['start'])
        self.assertTrue(first['bytes'].startswith('48 65 6C 6C 6F'))  # "Hello"
        msg_line = self.SOURCE.splitlines().index(
            '    msg     db      "Hello, World!", 0Ah') + 1
        self.assertEqual(first['line'], msg_line)

    def test_an_imported_binary_still_has_the_two_sections(self):
        # Um shellcode nao tem secao nenhuma: e codigo do primeiro ao ultimo
        # byte, e a `.data` existe vazia so para a regiao nunca faltar.
        response = self.client.post(
            '/api/program/disassemble/',
            {'data': base64.b64encode(b'\x90\x90\xc3').decode(), 'arch': 'x86_64'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        sections = response.json()['sections']
        self.assertEqual([s['name'] for s in sections], ['.text', '.data'])
        self.assertEqual(sections[1]['start'], sections[1]['end'])


class BinaryAnalysisTests(TransactionTestCase):
    """Um binario vindo de fora pode nao ser codigo de maquina.

    Nao ha resposta exata — qualquer sequencia de bytes decodifica em ALGUMA
    coisa, e o Capstone nunca falha de um jeito obvio. O que se mede sao
    indicios, e o teste trava justamente os que sustentam o aviso.
    """

    def analyze(self, data, arch='x86_64'):
        instructions = disassemble(data, arch=arch, base_address=0x400000)
        return analyze(data, instructions)

    def test_real_machine_code_passes(self):
        # Codigo montado de verdade: nada a apontar.
        data = assemble(
            '[BITS 64]\n xor rax, rax\n mov al, 60\n xor rdi, rdi\n syscall\n',
            arch='x86_64', base_address=0x400000).data
        report = self.analyze(data)
        self.assertEqual(report['verdict'], 'ok', report)
        self.assertEqual(report['reasons'], [])

    def test_text_file_is_flagged(self):
        report = self.analyze(b'Isto e um texto comum, nao um programa.\n' * 4)
        self.assertEqual(report['verdict'], 'suspect')
        self.assertIn('analysis.text', report['reasons'])

    def test_containers_are_named(self):
        for header, expected in ((b'MZ\x90\x00', 'analysis.container.pe'),
                                 (b'\x7fELF\x02\x01', 'analysis.container.elf'),
                                 (b'\x89PNG\r\n\x1a\n', 'analysis.container.image')):
            with self.subTest(expected=expected):
                report = self.analyze(header + bytes(200))
                self.assertEqual(report['verdict'], 'suspect')
                # Dizer "isto e um PE" ajuda mais que "40% de bytes invalidos".
                self.assertIn(expected, report['reasons'])

    def test_empty_input(self):
        self.assertEqual(self.analyze(b'')['verdict'], 'empty')

    def test_report_carries_the_numbers_behind_the_verdict(self):
        report = self.analyze(b'texto puro ' * 20)
        # O aviso mostra em que se baseia, em vez de so dizer "suspeito".
        self.assertGreater(report['printable_ratio'], 0.85)
        self.assertIn('size', report)
        self.assertIn('undecodable_ratio', report)


class BinaryImportTests(TransactionTestCase):
    """POST /api/program/import/ — binario cru vira codigo-fonte editavel."""

    def shellcode(self):
        source = (
            '[BITS 64]\n'
            '    jmp step1\n'
            'step2:\n'
            '    pop rdi\n'
            '    xor rax, rax\n'
            '    mov al, 59\n'
            '    syscall\n'
            'step1:\n'
            '    call step2\n'
            '    db "/bin/sh", 0x01\n'
        )
        data = assemble(source, arch='x86_64', base_address=0x400000).data
        return data

    def upload(self, data, name='shellcode.bin', **extra):
        payload = {'file': SimpleUploadedFile(name, data,
                                              content_type='application/octet-stream')}
        payload.update({'arch': 'x86_64', 'base_address': '0x400000', **extra})
        return self.client.post('/api/program/import/', payload)

    def test_returns_assemblable_source_with_labels(self):
        response = self.upload(self.shellcode())
        self.assertEqual(response.status_code, 200, response.content)
        source = response.json()['source']

        # Cabecalho honesto sobre o que aquilo e.
        self.assertIn('bits 64', source)
        self.assertIn('org 0x400000', source)
        # Destino de salto vira ROTULO: sem isso qualquer edicao no meio
        # quebraria todos os saltos de uma vez.
        self.assertIn('loc_400002:', source)
        self.assertIn('call loc_400002', source)
        # `short` preserva a codificacao de 2 bytes do salto original.
        self.assertIn('jmp short loc_40000A', source)
        # Os bytes originais ficam em comentario, para nada se perder.
        self.assertIn('E8 F3 FF FF FF', source)

    def test_generated_source_assembles_back_to_the_same_bytes(self):
        original = self.shellcode()
        source = self.upload(original).json()['source']

        rebuilt = assemble(source, arch='x86_64', base_address=0x400000).data
        self.assertEqual(rebuilt, original)

    def test_size_limit_is_enforced_by_the_server(self):
        response = self.upload(b'\x90' * (4 * 1024 + 1))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['limit'], 4096)

    def test_missing_and_empty_files_are_refused(self):
        self.assertEqual(
            self.client.post('/api/program/import/', {'arch': 'x86'}).status_code, 400)
        self.assertEqual(self.upload(b'').status_code, 400)

    def test_analysis_travels_with_the_source(self):
        clean = self.upload(self.shellcode()).json()
        self.assertEqual(clean['analysis']['verdict'], 'ok')

        suspect = self.upload(b'MZ' + bytes(300), name='a.exe').json()
        self.assertEqual(suspect['analysis']['verdict'], 'suspect')
        self.assertIn('analysis.container.pe', suspect['analysis']['reasons'])
        # Mesmo suspeito, o fonte vem: quem decide se olha e o aluno.
        self.assertIn('bits', suspect['source'])


def fake_ntdll(exports, machine=0x8664):
    """Monta uma DLL minima com stubs de syscall, para testar sem uma ntdll real.

    `exports` e ``[(nome, ssn)]``. O layout segue o de um PE de verdade — DOS
    header, PE header, uma secao, tabela de export — porque e exatamente isso
    que o parser percorre; um mock mais simples nao provaria nada.
    """
    import struct

    base = 0x1000            # RVA da secao
    raw = 0x400              # onde a secao comeca no arquivo
    body = bytearray()

    def rva(offset):
        return base + offset

    # Stubs: mov r10, rcx / mov eax, SSN / syscall / ret
    stubs = {}
    for name, ssn in exports:
        stubs[name] = rva(len(body))
        body += b'\x4c\x8b\xd1' + b'\xb8' + struct.pack('<I', ssn) + b'\x0f\x05\xc3'

    # Nomes
    name_rvas = {}
    for name, _ssn in exports:
        name_rvas[name] = rva(len(body))
        body += name.encode() + b'\x00'

    while len(body) % 4:
        body += b'\x00'

    functions_rva = rva(len(body))
    for name, _ssn in exports:
        body += struct.pack('<I', stubs[name])
    names_rva = rva(len(body))
    for name, _ssn in exports:
        body += struct.pack('<I', name_rvas[name])
    ordinals_rva = rva(len(body))
    for index, _ in enumerate(exports):
        body += struct.pack('<H', index)
    while len(body) % 4:
        body += b'\x00'

    export_rva = rva(len(body))
    # IMAGE_EXPORT_DIRECTORY, 40 bytes: os dois WORD de versao no meio sao o
    # que faz os offsets seguintes cairem onde caem.
    body += struct.pack(
        '<IIHHIIIIIII',
        0,                       # Characteristics
        0,                       # TimeDateStamp
        0, 0,                    # Major/MinorVersion
        0,                       # Name RVA
        1,                       # Base ordinal
        len(exports),            # NumberOfFunctions
        len(exports),            # NumberOfNames
        functions_rva,
        names_rva,
        ordinals_rva,
    )

    # --- cabecalhos ---
    dos = bytearray(0x40)
    dos[0:2] = b'MZ'
    struct.pack_into('<I', dos, 0x3C, 0x80)

    optional_size = 240
    coff = struct.pack('<IHHIIIHH', 0x00004550, machine, 1, 0, 0, 0, optional_size, 0x2000)

    optional = bytearray(optional_size)
    struct.pack_into('<H', optional, 0, 0x20B if machine == 0x8664 else 0x10B)
    # Offset do DataDirectory dentro do cabecalho opcional: 112 em PE32+, 96 em
    # PE32. Os numeros vem da especificacao, e nao do parser — um mock montado
    # a partir do mesmo mal-entendido do codigo passaria no teste e falharia na
    # DLL de verdade, que foi exatamente o que aconteceu aqui.
    directories = 112 if machine == 0x8664 else 96
    struct.pack_into('<II', optional, directories, export_rva, len(body))

    section = bytearray(40)
    section[0:5] = b'.text'
    struct.pack_into('<IIII', section, 8, len(body), base, len(body), raw)

    out = bytearray(raw)
    out[0:0x40] = dos
    out[0x80:0x80 + len(coff)] = coff
    out[0x80 + len(coff):0x80 + len(coff) + optional_size] = optional
    start = 0x80 + len(coff) + optional_size
    out[start:start + 40] = section
    return bytes(out) + bytes(body)


class NtdllTests(TransactionTestCase):
    """Import da ntdll.dll: extracao dos SSN e armazenamento volatil."""

    EXPORTS = [('NtCreateFile', 0x55), ('NtOpenProcess', 0x26),
               ('NtWriteFile', 0x08), ('RtlNotASyscall', 0x99)]

    def setUp(self):
        from asm_simulator.services import ntdll
        self.ntdll = ntdll
        ntdll.clear()

    def tearDown(self):
        self.ntdll.clear()

    def test_extracts_ssn_from_the_stubs(self):
        table = self.ntdll.parse(fake_ntdll(self.EXPORTS))

        self.assertEqual(table['arch'], 'x86_64')
        # `Rtl*` nao e syscall: so os `Nt*` entram.
        self.assertEqual(table['count'], 3)
        self.assertEqual(table['syscalls']['85'], 'NtCreateFile')
        self.assertEqual(table['syscalls']['38'], 'NtOpenProcess')
        self.assertEqual(table['syscalls']['8'], 'NtWriteFile')

    def test_reads_the_32_bit_stub_layout_too(self):
        table = self.ntdll.parse(fake_ntdll(self.EXPORTS, machine=0x014C))
        self.assertEqual(table['arch'], 'x86')
        self.assertEqual(table['syscalls']['85'], 'NtCreateFile')

    def test_reads_the_directory_at_the_pe32plus_offset(self):
        import struct

        blob = bytearray(fake_ntdll(self.EXPORTS))

        # Chamariz no offset do PE32 (96). Um parser que leia ali — o erro que
        # de fato existiu — pega este RVA invalido e falha. So passa quem le em
        # 112, que e onde a especificacao poe o DataDirectory num PE32+.
        pe = struct.unpack_from('<I', blob, 0x3C)[0]
        struct.pack_into('<II', blob, pe + 24 + 96, 0xDEADBEEF, 0x1000)

        table = self.ntdll.parse(bytes(blob))
        self.assertEqual(table['syscalls']['85'], 'NtCreateFile')

    def test_rejects_what_is_not_a_dll(self):
        for data, key in ((b'nao sou um PE', 'ntdll.notPe'),
                          (b'MZ' + bytes(200), 'ntdll.notPe')):
            with self.subTest(key=key):
                with self.assertRaises(self.ntdll.NtdllError) as ctx:
                    self.ntdll.parse(data)
                self.assertEqual(str(ctx.exception), key)

    def test_upload_stores_and_status_reports_it(self):
        blob = SimpleUploadedFile('ntdll.dll', fake_ntdll(self.EXPORTS),
                                  content_type='application/octet-stream')
        response = self.client.post('/api/ntdll/', {'file': blob})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['count'], 3)
        self.assertEqual(response.json()['syscalls']['85'], 'NtCreateFile')

        status_body = self.client.get('/api/ntdll/?arch=x86_64').json()
        self.assertEqual(status_body['loaded']['x86_64']['count'], 3)
        self.assertEqual(status_body['loaded']['x86_64']['origin'], 'ntdll.dll')
        self.assertEqual(status_body['syscalls']['38'], 'NtOpenProcess')

    def test_delete_unloads(self):
        self.client.post('/api/ntdll/', {'file': SimpleUploadedFile(
            'ntdll.dll', fake_ntdll(self.EXPORTS))})
        self.assertEqual(self.client.delete('/api/ntdll/').status_code, 204)
        self.assertEqual(self.client.get('/api/ntdll/').json()['loaded'], {})

    def test_a_table_from_a_previous_run_is_discarded(self):
        from unittest import mock

        self.client.post('/api/ntdll/', {'file': SimpleUploadedFile(
            'ntdll.dll', fake_ntdll(self.EXPORTS))})
        path = self.ntdll._store_path('x86_64')
        self.assertTrue(path.exists())

        # `/dev/shm` sozinho NAO bastaria: um `docker restart` preserva o
        # conteudo dele. O carimbo do boot e o que faz a tabela morrer junto
        # com a execucao que a importou.
        with mock.patch.object(self.ntdll, '_boot_id', return_value='outro-boot'):
            self.assertIsNone(self.ntdll.load('x86_64'))
            # E o arquivo sai de cena na hora, em vez de esperar a proxima leitura.
            self.assertFalse(path.exists())

    def test_storage_lives_in_memory_not_in_the_data_volume(self):
        from django.conf import settings

        self.client.post('/api/ntdll/', {'file': SimpleUploadedFile(
            'ntdll.dll', fake_ntdll(self.EXPORTS))})
        path = self.ntdll._store_path('x86_64')

        self.assertTrue(path.exists())
        # A tabela vale para UMA build do Windows. Guardada no volume, meses
        # depois resolveria numeros para os nomes errados com toda a confianca.
        self.assertNotIn(str(settings.DATA_DIR), str(path))
        self.assertTrue(str(path).startswith(('/dev/shm', '/tmp', '/var/folders')),
                        f'esperado armazenamento volatil, veio {path}')


class AddressWidthTests(TransactionTestCase):
    """Um programa de 32 bits nao pode morar acima de 0xFFFFFFFF.

    Aceitar isso nao daria erro visivel — daria pior. O Capstone guarda o
    endereco da instrucao em 64 bits mas calcula o alvo de um salto com a
    aritmetica de 32 do modo; os dois deixam de casar e a execucao para no
    primeiro `jmp`, sem dizer por que.
    """

    BASE64 = 0x00007FF700001000

    def test_capstone_really_disagrees_with_itself(self):
        # A prova do problema que a validacao existe para impedir.
        data = assemble('[BITS 32]\n jmp short fim\nfim:\n nop\n',
                        arch='x86', base_address=self.BASE64).data
        insn = disassemble(data, arch='x86', base_address=self.BASE64)[0]
        target = int(insn['operands'][0]['value'])

        self.assertEqual(int(insn['address']), self.BASE64)
        # O alvo veio truncado: nao ha instrucao nesse endereco.
        self.assertEqual(target, 0x1002)
        self.assertNotEqual(target, self.BASE64 + 2)

    def test_assemble_refuses_a_base_too_wide_for_the_arch(self):
        response = self.client.post(
            '/api/program/assemble/',
            data=json.dumps({'source': 'nop', 'arch': 'x86',
                             'base_address': hex(self.BASE64)}),
            content_type=JSON)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('32 bits', response.json()['detail'])

    def test_the_same_base_is_fine_in_64_bit(self):
        response = self.client.post(
            '/api/program/assemble/',
            data=json.dumps({'source': 'nop', 'arch': 'x86_64',
                             'base_address': hex(self.BASE64)}),
            content_type=JSON)
        self.assertEqual(response.status_code, 200, response.content)

    def test_import_refuses_it_too(self):
        response = self.client.post('/api/program/import/', {
            'arch': 'x86', 'base_address': hex(self.BASE64),
            'file': SimpleUploadedFile('a.bin', b'\x90\x90')})
        self.assertEqual(response.status_code, 400, response.content)

    def test_import_without_a_base_uses_the_arch_default(self):
        # E o caminho que o wizard toma quando a barra esta com o layout de 64
        # bits e o binario e de 32.
        response = self.client.post('/api/program/import/', {
            'arch': 'x86',
            'file': SimpleUploadedFile('a.bin', b'\xeb\x00\x90')})
        self.assertEqual(response.status_code, 200, response.content)

        base = int(response.json()['base_address'])
        self.assertLess(base, 1 << 32)
        # E o `org` do fonte gerado usa essa mesma base.
        self.assertIn(f'org 0x{base:X}', response.json()['source'])


class PrototypeTests(TransactionTestCase):
    """Os YAML de `prototypes/` sao escritos a mao — a suite os valida.

    Um `arg2` sem `arg1`, um nome que nao bate com o arquivo ou um campo
    faltando produziriam um painel silenciosamente errado, que e pior que um
    painel vazio.
    """

    def setUp(self):
        super().setUp()
        from asm_simulator.services import prototypes
        self.prototypes = prototypes

    def test_every_shipped_file_parses(self):
        directory = self.prototypes.PROTOTYPES_DIR
        files = sorted(directory.glob('*/*.yaml'))
        self.assertGreater(len(files), 0, 'nenhum prototipo encontrado')

        for path in files:
            with self.subTest(path=str(path.relative_to(directory))):
                # `parse` levanta PrototypeError com o arquivo na mensagem.
                self.prototypes.parse(path)

    def test_the_three_targets_are_populated(self):
        for os_id, arch_id in self.prototypes.TARGETS:
            with self.subTest(target=f'{os_id}-{arch_id}'):
                loaded = self.prototypes.load_target(os_id, arch_id)
                self.assertGreater(len(loaded), 0)

    def test_linux_prototypes_carry_the_syscall_number(self):
        write32 = self.prototypes.load('linux', 'x86', 'write')
        write64 = self.prototypes.load('linux', 'x86_64', 'write')

        # O MESMO nome, numeros diferentes: e a confusao que a separacao por
        # alvo existe para evitar.
        self.assertEqual(write32['ssn'], 4)
        self.assertEqual(write64['ssn'], 1)
        self.assertEqual([a['name'] for a in write32['input_args']],
                         ['fd', 'buf', 'count'])

    def test_windows_prototypes_have_no_fixed_number(self):
        for name, prototype in self.prototypes.load_target('windows', 'x86_64').items():
            with self.subTest(function=name):
                # O SSN vem da ntdll.dll importada, nao do arquivo: fixar um
                # aqui ensinaria errado.
                self.assertIsNone(prototype['ssn'])

    def test_user_mode_functions_are_marked_apart_from_syscalls(self):
        # Nem tudo que se chama na ntdll entra no kernel: `NtClose` e um stub
        # com `syscall` dentro, mas `RtlInitUnicodeString` roda inteiro em modo
        # usuario. Sem a marca, o auto-completar do painel de `syscall`
        # ofereceria uma pela outra.
        rtl = self.prototypes.load('windows', 'x86_64', 'RtlInitUnicodeString')
        self.assertEqual(rtl['kind'], 'function')
        self.assertIsNone(rtl['ssn'])
        self.assertEqual(rtl['library'], 'ntdll.dll')

        # A API do Windows entra no mesmo catalogo, separada pela DLL de origem.
        self.assertEqual(
            self.prototypes.load('windows', 'x86_64', 'WinExec')['library'], 'kernel32.dll')
        self.assertEqual(
            self.prototypes.load('windows', 'x86_64', 'bind')['library'], 'ws2_32.dll')

        self.assertEqual(
            self.prototypes.load('windows', 'x86_64', 'NtClose')['kind'], 'syscall')

    def test_summaries_can_be_filtered_by_kind(self):
        syscalls = self.prototypes.summaries('windows', 'x86_64', 'syscall')
        functions = self.prototypes.summaries('windows', 'x86_64', 'function')

        self.assertTrue(all(item['function_name'].startswith('Nt') for item in syscalls))
        # A funcao de modo usuario nao tem numero, e tem de dizer de qual DLL
        # sai: no Windows, achar o export e o passo anterior a chamada.
        self.assertTrue(all(item['ssn'] is None and item['library'] for item in functions))
        self.assertEqual(
            {item['library'] for item in functions},
            {'ntdll.dll', 'kernel32.dll', 'ws2_32.dll'})
        # Sem filtro vem tudo: e o que o painel de `call` usa, onde os dois
        # sao alvos legitimos.
        self.assertEqual(len(self.prototypes.summaries('windows', 'x86_64')),
                         len(syscalls) + len(functions))

    def test_a_pointer_typedef_finds_the_type_it_points_to(self):
        # `PFOO`, `PCFOO` e `LPFOO` sao o MESMO layout. Sem isto, o painel nao
        # oferece "ler como estrutura" justo nos tipos da API do Windows.
        for written in ('STARTUPINFOA', 'LPSTARTUPINFOA'):
            with self.subTest(type=written):
                found = self.prototypes.load_type('windows', 'x86_64', written)
                self.assertIsNotNone(found)
                self.assertEqual(found['type_name'], 'STARTUPINFOA')
                self.assertEqual(found['size'], 104)

        # Escrito como no header, com `const` e `*` no meio do caminho.
        found = self.prototypes.load_type('windows', 'x86_64', 'const sockaddr*')
        self.assertEqual(found['type_name'], 'sockaddr')

    def test_a_user_mode_function_with_a_syscall_number_is_refused(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'RtlSomething.yaml'
            path.write_text(
                'function_name: RtlSomething\n'
                'kind: function\n'
                'ssn: 42\n'
                'input_args: {}\n'
                'output_data: {type: "VOID", name: "none", description: "y"}\n',
                encoding='utf-8')

            # O numero so existe para quem cruza a fronteira do kernel; exibi-lo
            # convidaria a chamar um Rtl* por `syscall`.
            with self.assertRaises(self.prototypes.PrototypeError):
                self.prototypes.parse(path)

    def test_a_function_without_arguments_is_valid(self):
        getpid = self.prototypes.load('linux', 'x86_64', 'getpid')
        self.assertEqual(getpid['input_args'], [])
        self.assertEqual(getpid['output_data']['type'], 'pid_t')

    def test_windows_prototypes_declare_the_argument_direction(self):
        # Vem das anotacoes SAL dos headers do phnt. Diz o que o nome sozinho
        # nao diz: `BaseAddress` entra E sai.
        alloc = self.prototypes.load('windows', 'x86_64', 'NtAllocateVirtualMemory')
        by_name = {arg['name']: arg for arg in alloc['input_args']}

        self.assertEqual(by_name['ProcessHandle']['direction'], 'in')
        self.assertEqual(by_name['BaseAddress']['direction'], 'inout')
        self.assertEqual(by_name['RegionSize']['direction'], 'inout')

        protect = self.prototypes.load('windows', 'x86_64', 'NtProtectVirtualMemory')
        old_protection = next(a for a in protect['input_args']
                              if a['name'] == 'OldProtection')
        self.assertEqual(old_protection['direction'], 'out')

    def test_an_unknown_direction_is_refused(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'x.yaml'
            path.write_text(
                'function_name: x\n'
                'ssn: null\n'
                'input_args:\n'
                '  arg0: {type: "int", name: "a", description: "d", direction: "input"}\n'
                'output_data: {type: "int", name: "r", description: "y"}\n',
                encoding='utf-8')

            # "input" no lugar de "in" passaria despercebido e a interface
            # leria errado.
            with self.assertRaises(self.prototypes.PrototypeError):
                self.prototypes.parse(path)

    def test_a_gap_in_the_argument_sequence_is_refused(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'broken.yaml'
            path.write_text(
                'function_name: broken\n'
                'ssn: 1\n'
                'input_args:\n'
                '  arg0: {type: "int", name: "a", description: "x"}\n'
                '  arg2: {type: "int", name: "c", description: "z"}\n'
                'output_data: {type: "int", name: "r", description: "y"}\n',
                encoding='utf-8')

            # Com arg0 e arg2, qual e o segundo argumento? Nao ha resposta.
            with self.assertRaises(self.prototypes.PrototypeError) as ctx:
                self.prototypes.parse(path)
            self.assertIn('arg1', str(ctx.exception))

    def test_the_file_name_must_match_the_function(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'write.yaml'
            path.write_text(
                'function_name: read\n'
                'ssn: 1\n'
                'input_args: {}\n'
                'output_data: {type: "int", name: "r", description: "y"}\n',
                encoding='utf-8')

            with self.assertRaises(self.prototypes.PrototypeError):
                self.prototypes.parse(path)


class TypePrototypeTests(TransactionTestCase):
    """Layout de struct: offset e tamanho precisam estar EXATOS.

    Um erro aqui não aparece como falha — aparece como um campo mostrando o
    byte errado, com toda a aparência de estar certo.
    """

    def setUp(self):
        super().setUp()
        from asm_simulator.services import prototypes
        self.prototypes = prototypes

    def test_every_shipped_type_parses(self):
        directory = self.prototypes.PROTOTYPES_DIR / 'types'
        files = sorted(directory.glob('*/*.yaml'))
        self.assertGreater(len(files), 0)
        for path in files:
            with self.subTest(path=str(path.relative_to(directory))):
                self.prototypes.parse_type(path)

    def test_windows_layout_matches_the_known_sizes(self):
        # Os offsets do Windows são CALCULADOS (o phnt não compila fora do SDK
        # da Microsoft), então batem contra valores conhecidos do x86-64.
        known = {'OBJECT_ATTRIBUTES': 48, 'UNICODE_STRING': 16,
                 'IO_STATUS_BLOCK': 16, 'CLIENT_ID': 16}
        for name, size in known.items():
            with self.subTest(type=name):
                found = self.prototypes.load_type('windows', 'x86_64', name)
                self.assertIsNotNone(found, f'{name} não está no catálogo')
                self.assertEqual(found['size'], size)

    def test_object_attributes_has_the_padding_right(self):
        found = self.prototypes.load_type('windows', 'x86_64', 'OBJECT_ATTRIBUTES')
        by_name = {f['name']: f for f in found['fields']}

        # `Length` é ULONG (4 bytes) mas `RootDirectory` é HANDLE (8): o
        # compilador insere 4 bytes de preenchimento entre os dois.
        self.assertEqual(by_name['Length']['offset'], 0)
        self.assertEqual(by_name['RootDirectory']['offset'], 8)
        self.assertEqual(by_name['SecurityQualityOfService']['offset'], 40)

    def test_anonymous_union_becomes_a_nested_block(self):
        found = self.prototypes.load_type('windows', 'x86_64', 'IO_STATUS_BLOCK')
        first = found['fields'][0]

        # A union sem nome mora no MESMO endereço da struct e carrega os campos
        # dela como filhos.
        self.assertEqual(first['offset'], 0)
        self.assertIn('fields', first)
        names = {f['name'] for f in first['fields']}
        self.assertEqual(names, {'Status', 'Pointer'})
        self.assertTrue(all(f['offset'] == 0 for f in first['fields']))

    def test_linux_layout_differs_between_32_and_64_bits(self):
        # Medido pelo compilador nas duas arquiteturas. `iovec` tem um ponteiro
        # e um size_t: 8 bytes em 32 bits, 16 em 64.
        wide = self.prototypes.load_type('linux', 'x86_64', 'iovec')
        narrow = self.prototypes.load_type('linux', 'x86', 'iovec')

        self.assertEqual(wide['size'], 16)
        self.assertEqual(narrow['size'], 8)
        self.assertEqual(wide['fields'][1]['offset'], 8)
        self.assertEqual(narrow['fields'][1]['offset'], 4)

    def test_pointer_type_names_resolve_to_the_struct(self):
        # A convenção do Windows: `POBJECT_ATTRIBUTES` e `PCOBJECT_ATTRIBUTES`
        # são ponteiros para `OBJECT_ATTRIBUTES`. É como o argumento do
        # protótipo chega até aqui.
        for name in ('OBJECT_ATTRIBUTES', 'POBJECT_ATTRIBUTES', 'PCOBJECT_ATTRIBUTES'):
            with self.subTest(name=name):
                found = self.prototypes.load_type('windows', 'x86_64', name)
                self.assertEqual(found['type_name'], 'OBJECT_ATTRIBUTES')

    def test_a_field_past_the_end_of_the_type_is_refused(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'BROKEN.yaml'
            path.write_text(
                'type_name: BROKEN\n'
                'size: 8\n'
                'fields:\n'
                '  field0: {type: "ULONG", name: "a", offset: 4, size: 8}\n',
                encoding='utf-8')

            # Ler esse campo passaria do fim do objeto e mostraria memória de
            # outra coisa como se fosse dele.
            with self.assertRaises(self.prototypes.PrototypeError) as ctx:
                self.prototypes.parse_type(path)
            self.assertIn('past the', str(ctx.exception))

    def test_the_api_serves_names_and_layouts(self):
        listing = self.client.get('/api/types/?os=windows&arch=x86_64').json()
        self.assertIn('OBJECT_ATTRIBUTES', listing['types'])

        one = self.client.get(
            '/api/types/?os=linux&arch=x86_64&name=sockaddr_in').json()['type']
        self.assertEqual(one['size'], 16)
        self.assertEqual([f['name'] for f in one['fields']],
                         ['sin_family', 'sin_port', 'sin_addr'])

        self.assertEqual(
            self.client.get('/api/types/?os=linux&arch=x86_64&name=NaoExiste').status_code,
            404)

    def test_a_generic_type_names_the_layouts_it_can_be(self):
        # `sockaddr` sozinho nao diz nada: os 14 bytes de `sa_data` so tomam
        # forma depois de ler a familia. O mapa numero -> tipo vive no arquivo
        # do ALVO porque os numeros mudam: AF_INET6 e 10 no Linux e 23 no
        # Windows.
        for target, expected in ((('linux', 'x86_64'), {'1': 'sockaddr_un',
                                                        '2': 'sockaddr_in',
                                                        '10': 'sockaddr_in6'}),
                                 (('windows', 'x86_64'), {'2': 'sockaddr_in'})):
            os_id, arch_id = target
            with self.subTest(target=target):
                found = self.prototypes.load_type(os_id, arch_id, 'sockaddr')
                self.assertEqual(found['variants']['field'], 'sa_family')
                self.assertEqual(found['variants']['cases'], expected)

    def test_every_variant_points_to_a_type_that_exists(self):
        # Um caso apontando para tipo inexistente deixaria o painel preso no
        # generico, sem dizer por que.
        for os_id, arch_id in self.prototypes.TARGETS:
            known = self.prototypes.load_types(os_id, arch_id)
            for name, layout in known.items():
                for value, derived in (layout.get('variants') or {}).get('cases', {}).items():
                    with self.subTest(target=f'{os_id}-{arch_id}', type=name, case=value):
                        self.assertIn(derived, known)

    def test_a_variant_on_an_unknown_field_is_refused(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'x.yaml'
            path.write_text(
                'type_name: x\n'
                'size: 4\n'
                'variants: {field: nao_existe, cases: {1: y}}\n'
                'fields:\n'
                '  field0: {name: a, offset: 0, size: 4}\n',
                encoding='utf-8')

            with self.assertRaises(self.prototypes.PrototypeError):
                self.prototypes.parse_type(path)

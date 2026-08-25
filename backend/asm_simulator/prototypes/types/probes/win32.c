/* Confere, pelo COMPILADOR, o layout dos tipos Win32 dos novos prototipos.
   Cross-compilado para x86-64 com mingw-w64; um valor errado nao compila.
     x86_64-w64-mingw32-gcc -c verify_win32.c                                */
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stddef.h>

#define SIZE(t, n)      _Static_assert(sizeof(t) == (n), #t " size")
#define AT(t, f, n)     _Static_assert(offsetof(t, f) == (n), #t "." #f)

/* --- tipos novos --------------------------------------------------------- */
SIZE(STARTUPINFOA, 104);
AT(STARTUPINFOA, cb, 0);
AT(STARTUPINFOA, lpReserved, 8);
AT(STARTUPINFOA, lpDesktop, 16);
AT(STARTUPINFOA, lpTitle, 24);
AT(STARTUPINFOA, dwX, 32);
AT(STARTUPINFOA, dwY, 36);
AT(STARTUPINFOA, dwXSize, 40);
AT(STARTUPINFOA, dwYSize, 44);
AT(STARTUPINFOA, dwXCountChars, 48);
AT(STARTUPINFOA, dwYCountChars, 52);
AT(STARTUPINFOA, dwFillAttribute, 56);
AT(STARTUPINFOA, dwFlags, 60);
AT(STARTUPINFOA, wShowWindow, 64);
AT(STARTUPINFOA, cbReserved2, 66);
AT(STARTUPINFOA, lpReserved2, 72);
AT(STARTUPINFOA, hStdInput, 80);
AT(STARTUPINFOA, hStdOutput, 88);
AT(STARTUPINFOA, hStdError, 96);

SIZE(struct sockaddr, 16);
AT(struct sockaddr, sa_family, 0);
AT(struct sockaddr, sa_data, 2);

/* --- tipos que o catalogo ja tinha (regressao) ---------------------------- */
SIZE(STARTUPINFOW, 104);
SIZE(PROCESS_INFORMATION, 24);
AT(PROCESS_INFORMATION, hProcess, 0);
AT(PROCESS_INFORMATION, hThread, 8);
AT(PROCESS_INFORMATION, dwProcessId, 16);
AT(PROCESS_INFORMATION, dwThreadId, 20);
SIZE(struct sockaddr_in, 16);
AT(struct sockaddr_in, sin_port, 2);
AT(struct sockaddr_in, sin_addr, 4);
SIZE(SECURITY_ATTRIBUTES, 24);

/* Tamanho dos escalares usados nas assinaturas. */
_Static_assert(sizeof(SOCKET) == 8, "SOCKET");
_Static_assert(sizeof(HANDLE) == 8, "HANDLE");
_Static_assert(sizeof(DWORD) == 4, "DWORD");
_Static_assert(sizeof(WORD) == 2, "WORD");
_Static_assert(sizeof(BOOL) == 4, "BOOL");

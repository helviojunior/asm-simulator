/* Mede o layout x86-64 das estruturas do PEB/TEB, como o phnt as declara.
   As regras de alinhamento do SysV x86-64 e do MS x64 sao as mesmas para
   estes campos (nenhum `long`), entao o valor medido aqui vale no Windows. */
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef uint8_t   BOOLEAN;
typedef uint8_t   UCHAR;
typedef uint16_t  USHORT;
typedef int16_t   SHORT;
typedef uint32_t  ULONG;
typedef uint32_t  LCID;
typedef int64_t   LONGLONG;
typedef void     *PVOID;
typedef void     *HANDLE;
typedef uintptr_t ULONG_PTR;
typedef uint16_t *PWSTR;
typedef char     *PCSTR;

typedef struct _LIST_ENTRY { struct _LIST_ENTRY *Flink, *Blink; } LIST_ENTRY;
typedef struct _UNICODE_STRING { USHORT Length; USHORT MaximumLength; PWSTR Buffer; } UNICODE_STRING;
typedef union  _LARGE_INTEGER { LONGLONG QuadPart; } LARGE_INTEGER;
typedef struct _RTL_BALANCED_NODE {
    union { struct _RTL_BALANCED_NODE *Children[2];
            struct { struct _RTL_BALANCED_NODE *Left, *Right; }; };
    union { UCHAR Red; ULONG_PTR ParentValue; };
} RTL_BALANCED_NODE;

typedef struct _CLIENT_ID { HANDLE UniqueProcess; HANDLE UniqueThread; } CLIENT_ID;

typedef struct _NT_TIB {
    PVOID ExceptionList; PVOID StackBase; PVOID StackLimit; PVOID SubSystemTib;
    union { PVOID FiberData; ULONG Version; };
    PVOID ArbitraryUserPointer; struct _NT_TIB *Self;
} NT_TIB;

typedef struct _PEB_LDR_DATA {
    ULONG Length; BOOLEAN Initialized; HANDLE SsHandle;
    LIST_ENTRY InLoadOrderModuleList, InMemoryOrderModuleList, InInitializationOrderModuleList;
    PVOID EntryInProgress; BOOLEAN ShutdownInProgress; HANDLE ShutdownThreadId;
} PEB_LDR_DATA;

typedef struct _LDR_MODULE {
    LIST_ENTRY InLoadOrderModuleList, InMemoryOrderModuleList, InInitializationOrderModuleList;
    PVOID BaseAddress; PVOID EntryPoint; ULONG SizeOfImage;
    UNICODE_STRING FullDllName, BaseDllName;
    ULONG Flags; SHORT LoadCount; SHORT TlsIndex;
    LIST_ENTRY HashTableEntry; ULONG TimeDateStamp;
} LDR_MODULE;

typedef struct _LDR_DATA_TABLE_ENTRY {
    LIST_ENTRY InLoadOrderLinks, InMemoryOrderLinks, InInitializationOrderLinks;
    PVOID DllBase, EntryPoint; ULONG SizeOfImage;
    UNICODE_STRING FullDllName, BaseDllName;
    union { UCHAR FlagGroup[4]; ULONG Flags; };
    USHORT ObsoleteLoadCount, TlsIndex;
    LIST_ENTRY HashLinks; ULONG TimeDateStamp;
    PVOID EntryPointActivationContext, Lock, DdagNode;
    LIST_ENTRY NodeModuleLink;
    PVOID LoadContext, ParentDllBase, SwitchBackContext;
    RTL_BALANCED_NODE BaseAddressIndexNode, MappingInfoIndexNode;
    PVOID OriginalBase; LARGE_INTEGER LoadTime;
    ULONG BaseNameHashValue; ULONG LoadReason; ULONG ImplicitPathOptions;
    ULONG ReferenceCount; ULONG DependentLoadFlags; UCHAR SigningLevel;
    ULONG CheckSum; PVOID ActivePatchImageBase; ULONG HotPatchState;
} LDR_DATA_TABLE_ENTRY;

typedef struct _TEB_ACTIVE_FRAME_CONTEXT { ULONG Flags; PCSTR FrameName; } TEB_ACTIVE_FRAME_CONTEXT;
typedef struct _TEB_ACTIVE_FRAME { ULONG Flags; struct _TEB_ACTIVE_FRAME *Previous; TEB_ACTIVE_FRAME_CONTEXT *Context; } TEB_ACTIVE_FRAME;
typedef struct _GDI_TEB_BATCH { ULONG Offset; ULONG_PTR HDC; ULONG Buffer[310]; } GDI_TEB_BATCH;
typedef struct _RTL_ACTIVATION_CONTEXT_STACK_FRAME { struct _RTL_ACTIVATION_CONTEXT_STACK_FRAME *Previous; PVOID ActivationContext; ULONG Flags; } RTL_ACTIVATION_CONTEXT_STACK_FRAME;
typedef struct _ACTIVATION_CONTEXT_STACK {
    RTL_ACTIVATION_CONTEXT_STACK_FRAME *ActiveFrame; LIST_ENTRY FrameListCache;
    ULONG Flags, NextCookieSequenceNumber, StackId;
} ACTIVATION_CONTEXT_STACK;
typedef struct _INITIAL_TEB {
    struct { PVOID OldStackBase, OldStackLimit; } OldInitialTeb;
    PVOID StackBase, StackLimit, StackAllocationBase;
} INITIAL_TEB;
typedef union _USER_APC_OPTION { ULONG_PTR UserApcFlags; HANDLE MemoryReserveHandle; } USER_APC_OPTION;

typedef struct _PEB {
    BOOLEAN InheritedAddressSpace, ReadImageFileExecOptions, BeingDebugged;
    union { BOOLEAN BitField; };
    HANDLE Mutant; PVOID ImageBaseAddress; PVOID Ldr; PVOID ProcessParameters;
    PVOID SubSystemData; PVOID ProcessHeap; PVOID FastPebLock; PVOID AtlThunkSListPtr;
    HANDLE IFEOKey; union { ULONG CrossProcessFlags; };
    union { PVOID KernelCallbackTable; PVOID UserSharedInfoPtr; };
    ULONG SystemReserved, AtlThunkSListPtr32; PVOID ApiSetMap;
    ULONG TlsExpansionCounter; PVOID TlsBitmap; ULONG TlsBitmapBits[2];
    PVOID ReadOnlySharedMemoryBase, SharedData, ReadOnlyStaticServerData;
    PVOID AnsiCodePageData, OemCodePageData, UnicodeCaseTableData;
    ULONG NumberOfProcessors, NtGlobalFlag;
} PEB;

typedef struct _TEB {
    NT_TIB NtTib; PVOID EnvironmentPointer; CLIENT_ID ClientId;
    PVOID ActiveRpcHandle, ThreadLocalStoragePointer, ProcessEnvironmentBlock;
    ULONG LastErrorValue, CountOfOwnedCriticalSections;
    PVOID CsrClientThread, Win32ThreadInfo;
    ULONG User32Reserved[26], UserReserved[5];
    PVOID WOW32Reserved; LCID CurrentLocale; ULONG FpSoftwareStatusRegister;
} TEB;

#define S(t)      printf("%s|size|%zu|align|%zu\n", #t, sizeof(t), _Alignof(t))
#define O(t, f)   printf("%s|%s|%zu\n", #t, #f, offsetof(t, f))

int main(void) {
    S(NT_TIB); O(NT_TIB, ExceptionList); O(NT_TIB, StackBase); O(NT_TIB, StackLimit);
    O(NT_TIB, SubSystemTib); O(NT_TIB, FiberData); O(NT_TIB, ArbitraryUserPointer); O(NT_TIB, Self);

    S(CLIENT_ID); O(CLIENT_ID, UniqueProcess); O(CLIENT_ID, UniqueThread);

    S(PEB_LDR_DATA); O(PEB_LDR_DATA, Length); O(PEB_LDR_DATA, Initialized); O(PEB_LDR_DATA, SsHandle);
    O(PEB_LDR_DATA, InLoadOrderModuleList); O(PEB_LDR_DATA, InMemoryOrderModuleList);
    O(PEB_LDR_DATA, InInitializationOrderModuleList); O(PEB_LDR_DATA, EntryInProgress);
    O(PEB_LDR_DATA, ShutdownInProgress); O(PEB_LDR_DATA, ShutdownThreadId);

    S(LDR_MODULE); O(LDR_MODULE, InLoadOrderModuleList); O(LDR_MODULE, InMemoryOrderModuleList);
    O(LDR_MODULE, InInitializationOrderModuleList); O(LDR_MODULE, BaseAddress); O(LDR_MODULE, EntryPoint);
    O(LDR_MODULE, SizeOfImage); O(LDR_MODULE, FullDllName); O(LDR_MODULE, BaseDllName);
    O(LDR_MODULE, Flags); O(LDR_MODULE, LoadCount); O(LDR_MODULE, TlsIndex);
    O(LDR_MODULE, HashTableEntry); O(LDR_MODULE, TimeDateStamp);

    S(LDR_DATA_TABLE_ENTRY);
    O(LDR_DATA_TABLE_ENTRY, InLoadOrderLinks); O(LDR_DATA_TABLE_ENTRY, InMemoryOrderLinks);
    O(LDR_DATA_TABLE_ENTRY, InInitializationOrderLinks); O(LDR_DATA_TABLE_ENTRY, DllBase);
    O(LDR_DATA_TABLE_ENTRY, EntryPoint); O(LDR_DATA_TABLE_ENTRY, SizeOfImage);
    O(LDR_DATA_TABLE_ENTRY, FullDllName); O(LDR_DATA_TABLE_ENTRY, BaseDllName);
    O(LDR_DATA_TABLE_ENTRY, Flags); O(LDR_DATA_TABLE_ENTRY, ObsoleteLoadCount);
    O(LDR_DATA_TABLE_ENTRY, TlsIndex); O(LDR_DATA_TABLE_ENTRY, HashLinks);
    O(LDR_DATA_TABLE_ENTRY, TimeDateStamp); O(LDR_DATA_TABLE_ENTRY, EntryPointActivationContext);
    O(LDR_DATA_TABLE_ENTRY, Lock); O(LDR_DATA_TABLE_ENTRY, DdagNode);
    O(LDR_DATA_TABLE_ENTRY, NodeModuleLink); O(LDR_DATA_TABLE_ENTRY, LoadContext);
    O(LDR_DATA_TABLE_ENTRY, ParentDllBase); O(LDR_DATA_TABLE_ENTRY, SwitchBackContext);
    O(LDR_DATA_TABLE_ENTRY, BaseAddressIndexNode); O(LDR_DATA_TABLE_ENTRY, MappingInfoIndexNode);
    O(LDR_DATA_TABLE_ENTRY, OriginalBase); O(LDR_DATA_TABLE_ENTRY, LoadTime);
    O(LDR_DATA_TABLE_ENTRY, BaseNameHashValue); O(LDR_DATA_TABLE_ENTRY, LoadReason);
    O(LDR_DATA_TABLE_ENTRY, ImplicitPathOptions); O(LDR_DATA_TABLE_ENTRY, ReferenceCount);
    O(LDR_DATA_TABLE_ENTRY, DependentLoadFlags); O(LDR_DATA_TABLE_ENTRY, SigningLevel);
    O(LDR_DATA_TABLE_ENTRY, CheckSum); O(LDR_DATA_TABLE_ENTRY, ActivePatchImageBase);
    O(LDR_DATA_TABLE_ENTRY, HotPatchState);

    S(TEB_ACTIVE_FRAME_CONTEXT); O(TEB_ACTIVE_FRAME_CONTEXT, Flags); O(TEB_ACTIVE_FRAME_CONTEXT, FrameName);
    S(TEB_ACTIVE_FRAME); O(TEB_ACTIVE_FRAME, Flags); O(TEB_ACTIVE_FRAME, Previous); O(TEB_ACTIVE_FRAME, Context);
    S(GDI_TEB_BATCH); O(GDI_TEB_BATCH, Offset); O(GDI_TEB_BATCH, HDC); O(GDI_TEB_BATCH, Buffer);
    S(RTL_ACTIVATION_CONTEXT_STACK_FRAME); O(RTL_ACTIVATION_CONTEXT_STACK_FRAME, Previous);
    O(RTL_ACTIVATION_CONTEXT_STACK_FRAME, ActivationContext); O(RTL_ACTIVATION_CONTEXT_STACK_FRAME, Flags);
    S(ACTIVATION_CONTEXT_STACK); O(ACTIVATION_CONTEXT_STACK, ActiveFrame); O(ACTIVATION_CONTEXT_STACK, FrameListCache);
    O(ACTIVATION_CONTEXT_STACK, Flags); O(ACTIVATION_CONTEXT_STACK, NextCookieSequenceNumber); O(ACTIVATION_CONTEXT_STACK, StackId);
    S(INITIAL_TEB); O(INITIAL_TEB, OldInitialTeb); O(INITIAL_TEB, StackBase); O(INITIAL_TEB, StackLimit); O(INITIAL_TEB, StackAllocationBase);
    S(USER_APC_OPTION); O(USER_APC_OPTION, UserApcFlags); O(USER_APC_OPTION, MemoryReserveHandle);

    S(PEB);
    O(PEB, InheritedAddressSpace); O(PEB, ReadImageFileExecOptions); O(PEB, BeingDebugged); O(PEB, BitField);
    O(PEB, Mutant); O(PEB, ImageBaseAddress); O(PEB, Ldr); O(PEB, ProcessParameters); O(PEB, SubSystemData);
    O(PEB, ProcessHeap); O(PEB, FastPebLock); O(PEB, AtlThunkSListPtr); O(PEB, IFEOKey); O(PEB, CrossProcessFlags);
    O(PEB, KernelCallbackTable); O(PEB, SystemReserved); O(PEB, AtlThunkSListPtr32); O(PEB, ApiSetMap);
    O(PEB, TlsExpansionCounter); O(PEB, TlsBitmap); O(PEB, TlsBitmapBits); O(PEB, ReadOnlySharedMemoryBase);
    O(PEB, SharedData); O(PEB, ReadOnlyStaticServerData); O(PEB, AnsiCodePageData); O(PEB, OemCodePageData);
    O(PEB, UnicodeCaseTableData); O(PEB, NumberOfProcessors); O(PEB, NtGlobalFlag);

    S(TEB);
    O(TEB, NtTib); O(TEB, EnvironmentPointer); O(TEB, ClientId); O(TEB, ActiveRpcHandle);
    O(TEB, ThreadLocalStoragePointer); O(TEB, ProcessEnvironmentBlock); O(TEB, LastErrorValue);
    O(TEB, CountOfOwnedCriticalSections); O(TEB, CsrClientThread); O(TEB, Win32ThreadInfo);
    O(TEB, User32Reserved); O(TEB, UserReserved); O(TEB, WOW32Reserved); O(TEB, CurrentLocale);
    O(TEB, FpSoftwareStatusRegister);
    return 0;
}

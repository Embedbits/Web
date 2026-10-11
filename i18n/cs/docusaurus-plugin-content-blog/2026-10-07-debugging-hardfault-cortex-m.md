---
title: "Ladění HardFaultu na Cortex-M: od záhady k řádku kódu"
slug: debugging-hardfault-cortex-m
date: 2026-10-07T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Každý embedded vývojář zná ten okamžik: firmware běžel, a pak najednou neběží. Debugger ukazuje, že program sedí v nekonečné smyčce se jménem jako `HardFault_Handler` nebo `Default_Handler`, a call stack tvoří pár nic neříkajících rámců. Ta smyčka je **výchozí** handler ze startup kódu a o tom, co se stalo, neříká absolutně nic. Chyba má ale příčinu a procesor si ji už zapsal: v osmi registrech na zásobníku a ve čtyřech stavových registrech. Stačí je jen přečíst.

Tento článek ukazuje, jak z té smyčky získat řádek zdrojového kódu, na dvou skutečných příkladech, které jsem spustil v QEMU (model desky se STM32F4) a prozkoumal pomocí GDB: volání ukazatele na funkci s hodnotou `NULL` a zápis na adresu, kde nic není. Všechny výstupy jsou skutečné.

<!-- truncate -->

## Co jádro udělá, když nastane chyba

Cortex-M nepadá tiše. Když procesor nemůže pokračovat (neplatná instrukce, chyba sběrnice, nepovolený přístup), vyvolá **výjimku** a udělá dvě věci důležité pro ladění:

1. **Uloží osm registrů na zásobník**: `R0`, `R1`, `R2`, `R3`, `R12`, `LR`, `PC` a `xPSR`. Uložený `PC` je instrukce, která chybu způsobila, a uložený `LR` říká, kdo chybující funkci zavolal.
2. Nastaví **bity ve stavových registrech chyb**, které říkají, o jaký druh chyby šlo: `CFSR` (configurable fault status, složený ze tří částí pro memory, bus a usage fault), `HFSR` (hard fault status) a adresní registry `MMFAR` a `BFAR` s adresou, ke které se přistupovalo.

Memory, bus a usage fault mají své vlastní handlery, ale po resetu jsou **zakázané**, takže každá chyba je *eskalována* na HardFault. Proto jediný handler vidí všechno a bit `FORCED` v `HFSR` říká, že k tomu došlo.

## Handler, který čte registry

Jediná potíž je dostat se na zásobník, kde registry leží. Jádro má dva ukazatele zásobníku (`MSP` pro výjimky a hlavní kód, `PSP` pro úlohy operačního systému) a bit 2 hodnoty v `LR` při vstupu do výjimky říká, který z nich byl použit. To je nutné udělat *dříve*, než překladač použije zásobník pro své účely, takže handler je krátká funkce v assembleru (`naked`: bez prologu), která předá ukazatel funkci v C:

```c title="fault.c (the report)"
/* ---- the fault report ---- */
#define SCB_CFSR  (*(volatile uint32_t *)0xE000ED28u)   /* configurable fault status */
#define SCB_HFSR  (*(volatile uint32_t *)0xE000ED2Cu)   /* hard fault status */
#define SCB_MMFAR (*(volatile uint32_t *)0xE000ED34u)
#define SCB_BFAR  (*(volatile uint32_t *)0xE000ED38u)

/* The registers that the core pushed on the stack when the fault happened. */
typedef struct
{
    uint32_t r0, r1, r2, r3, r12;
    uint32_t lr;     /* where the faulting code was called from */
    uint32_t pc;     /* the instruction that caused the fault   */
    uint32_t xpsr;
}   stackFrame_t;

volatile struct
{
    stackFrame_t frame;
    uint32_t     cfsr, hfsr, mmfar, bfar;
}   faultInfo;

void HardFault_Report(const stackFrame_t *frame) __attribute__((used));
void HardFault_Report(const stackFrame_t *frame)
{
    faultInfo.frame = *frame;
    faultInfo.cfsr  = SCB_CFSR;
    faultInfo.hfsr  = SCB_HFSR;
    faultInfo.mmfar = SCB_MMFAR;
    faultInfo.bfar  = SCB_BFAR;

    Print("*** HardFault ***\n");
    PrintHex("PC   ", frame->pc);
    PrintHex("LR   ", frame->lr);
    PrintHex("xPSR ", frame->xpsr);
    PrintHex("CFSR ", faultInfo.cfsr);
    PrintHex("HFSR ", faultInfo.hfsr);

    for (;;) { }          /* stay here, so that a debugger can look at the state */
}

/* The core uses the main or the process stack, depending on bit 2 of EXC_RETURN (in LR). */
__attribute__((naked)) void HardFault_Handler(void)
{
    __asm__ volatile (
        "tst   lr, #4        \n"
        "ite   eq            \n"
        "mrseq r0, msp       \n"
        "mrsne r0, psp       \n"
        "b     HardFault_Report \n"
    );
}
```

Podívejte se na tři části. Struktura `stackFrame_t` je rozložení osmi registrů v pořadí, v jakém je jádro ukládá. Funkce `HardFault_Report()` (spolu se stavovými registry) zkopíruje do globální proměnné `faultInfo`, vypíše krátkou zprávu a pak **záměrně zůstane ve smyčce**, aby se mohl připojit debugger a proměnnou si prohlédnout. Assemblerová vložka vybere správný zásobník a skočí do ní. V produktu by se zpráva zapsala do paměti, která přežije reset, a firmware by se sám resetoval, ale princip je stejný.

## Příklad 1: volání ukazatele `NULL`

Toto je aplikace s chybou. Callback se zaregistruje později, ale kód, který ho volá, běží dříve:

```c title="fault.c (the application)"
/* ---- the application with a bug ---- */
typedef void (*callback_t)(void);

static callback_t onButtonPressed;      /* will be registered later: it is NULL at the start */

void Button_Pressed(void)
{
    onButtonPressed();                  /* the bug: the callback is called before it is set */
}

int main(void)
{
    Print("start\n");
    Button_Pressed();
    Print("never printed\n");
    return 0;
}
```

Program vypíše `start` a potom zprávu:

```text
start
*** HardFault ***
PC    0x00000000
LR    0x08000115
xPSR  0x60000000
CFSR  0x00020000
HFSR  0x40000000
```

Teď její čtení, hodnotu po hodnotě:

- **`PC = 0x00000000`**: procesor se pokusil provést instrukci na adrese nula. Téměř vždy to znamená skok přes ukazatel na funkci s hodnotou `NULL` nebo návrat na poškozenou adresu.
- **`CFSR = 0x00020000`**: bit 17 je `INVSTATE`, „invalid state". Procesor se pokusil vykonávat kód ve stavu ARM, který Cortex-M nemá. Důvod je v **`xPSR`**: jeho bit 24 je bit `T` (Thumb) a tady je nulový (`0x60000000`). Adresa funkce v Thumbu má nejnižší bit nastavený, `NULL` ho nemá, takže skok přes ukazatel bit `T` vynuloval. Nulový bit `T` je typický otisk prstu skoku na `NULL`.
- **`HFSR = 0x40000000`**: bit 30 je `FORCED`, chyba byla eskalována na HardFault z usage fault, který není povolen.
- **`LR = 0x08000115`**: návratová adresa s nastaveným nejnižším bitem (Thumb). Je to adresa **volajícího**, `0x08000114`, a právě tam je chyba.

S debuggerem trvá poslední krok pár sekund. QEMU čeká na GDB (`-S -gdb tcp::1234`) a session vypadá takto:

```text
(gdb) break fault.c:64
(gdb) continue
Breakpoint 1, HardFault_Report (frame=0x2001ffc0) at fault.c:64
(gdb) print/x faultInfo.frame
$1 = {r0 = 0xdeadbeef, r1 = 0x80001f4, r2 = 0x8000220, r3 = 0x0, r12 = 0x0,
      lr = 0x8000115, pc = 0x0, xpsr = 0x60000000}
(gdb) print/x faultInfo.cfsr
$2 = 0x20000
(gdb) info symbol faultInfo.frame.lr
Button_Pressed + 7 in section .text
(gdb) list *(faultInfo.frame.lr & ~1u)
0x8000114 is in Button_Pressed (fault.c:87).
82	static callback_t onButtonPressed;      /* will be registered later: it is NULL at the start */
84	void Button_Pressed(void)
85	{
86	    onButtonPressed();                  /* the bug: the callback is called before it is set */
87	}
(gdb) x/2i (faultInfo.frame.lr & ~1u) - 4
   0x8000110 <Button_Pressed+2>:	movs	r3, #0
   0x8000112 <Button_Pressed+4>:	blx	r3
```

`info symbol` vrátí funkci, `list *` řádek (ten *za* voláním, protože to je návratová adresa) a disassembly ukáže dvojici instrukcí, která je samotnou chybou: načtení nuly do `r3` a `blx r3`, volání přes registr obsahující `NULL`. Všimněte si `r3 = 0x0` v uložených registrech. Bez debuggeru je tatáž odpověď jedním příkazem toolchainu, který potřebuje jen adresu ze zprávy a soubor s ladicími informacemi (`-g`):

```text
$ arm-none-eabi-addr2line -e fault.elf -f 0x08000114
Button_Pressed
fault.c:87
```

## Příklad 2: zápis na adresu, kde nic není

Změnil jsem jeden řádek aplikace: místo callbacku funkce zapisuje na adresu `0xA0000000`, kde v modelu čipu není namapováno nic. Zpráva:

```text
*** HardFault ***
PC    0x08000124
LR    0x08000199
xPSR  0x21000000
CFSR  0x00008200
HFSR  0x40000000
```

Tentokrát je `PC` **platná adresa ve flash**, bit `T` je nastaven (`0x21000000`) a `CFSR` je jiný: `0x8200` jsou dva bity, 9 (`PRECISERR`, přesná chyba datové sběrnice) a 15 (`BFARVALID`, registr `BFAR` obsahuje adresu). V GDB:

```text
(gdb) print/x faultInfo.cfsr
$1 = 0x8200
(gdb) print/x faultInfo.bfar
$2 = 0xa0000000
(gdb) info symbol faultInfo.frame.pc
main + 12 in section .text
```

`BFAR` je adresa, na kterou se program pokusil zapisovat, `PC` je instrukce, která se o to pokusila. Dohromady říkají „tato instrukce zapsala na tuto adresu", což je úplný popis problému. Pokud je adresa malá (`0x00000008`), jde o ukazatel `NULL` na strukturu a vy přistupujete k jejímu členu. Pokud vypadá jako data (`0x20000000` a kousek víc), jde o zásobník nebo buffer, který jste přetekli.

## Bity CFSR, se kterými se setkáte

Registr je kombinací tří registrů (každý má svůj bajt nebo dva bajty). Tohle jsou ty, které uvidíte nejčastěji (dva, které jsem pozoroval v příkladech, jsou zvýrazněny):

| Bit | Název | Význam |
|---|---|---|
| 0 | `IACCVIOL` | načtení instrukce z nepovolené oblasti (MPU) |
| 1 | `DACCVIOL` | datový přístup do nepovolené oblasti (MPU) |
| 7 | `MMARVALID` | registr `MMFAR` obsahuje adresu |
| 8 | `IBUSERR` | chyba sběrnice při načítání instrukce |
| **9** | **`PRECISERR`** | **přesná chyba sběrnice při datovém přístupu: `PC` je instrukce, která ji způsobila** |
| 10 | `IMPRECISERR` | nepřesná chyba sběrnice: instrukce už je pryč, `PC` není spolehlivé |
| 11, 12 | `UNSTKERR`, `STKERR` | chyba sběrnice při vybírání nebo ukládání registrů (často poškozený zásobník) |
| **15** | **`BFARVALID`** | **registr `BFAR` obsahuje adresu** |
| 16 | `UNDEFINSTR` | nedefinovaná instrukce (provádění dat, poškozený kód) |
| **17** | **`INVSTATE`** | **pokus o provádění ve stavu ARM: skok na adresu s vynulovaným bitem 0** |
| 18 | `INVPC` | neplatná hodnota `EXC_RETURN` (poškozený zásobník výjimky) |
| 19 | `NOCP` | přístup k nepovolenému koprocesoru (typicky FPU, které nebylo zapnuto) |
| 24 | `UNALIGNED` | nezarovnaný přístup, je-li povolena past |
| 25 | `DIVBYZERO` | dělení nulou, je-li povolena past |

## Co obvykle stojí za HardFaultem

| Co vidíte | Co to obvykle je |
|---|---|
| `PC = 0`, `INVSTATE` | volání přes ukazatel na funkci `NULL` nebo návrat na poškozenou adresu |
| `PRECISERR` a malé `BFAR` | ukazatel `NULL` na strukturu |
| `PRECISERR` a `BFAR` v rozsahu adres periferií | přístup k nedostupné periferii, například takové, jejíž hodiny nebyly zapnuty (u některých rodin je takový přístup chybou sběrnice, u jiných se tiše ignoruje) |
| `STKERR` / `UNSTKERR` nebo `PC`, které nedává smysl | přetečení zásobníku nebo bufferu, které poškodilo návratovou adresu |
| `NOCP` u první instrukce s plovoucí řádovou čárkou | FPU nebylo povoleno ve startup kódu |
| `IMPRECISERR` | zápis, který prošel přes write buffer: zpráva přijde později než instrukce. Pro ladění lze buffering vypnout (bit `DISABLEDEFWRITEBUF` v `ACTLR`), takže chyba bude přesná |

První řádek tabulky a princip druhého (chyba sběrnice s adresou v `BFAR`) jsem předvedl. Zbývající řádky jsou souhrnem obvyklých příčin, vyplývají z významu bitů v referenční příručce jádra.

## Praxe

1. **Nikdy nenechávejte výchozí handler jako prázdnou smyčku.** Handler výše má asi třicet řádků a promění chybu ve zprávu s místem v kódu. Vložte ho jednou do startup kódu projektu.
2. **Uchovávejte ladicí informace** v souboru, který archivujete s vydáním (`-g` a `.elf`), aby šla adresa ze zprávy z provozu převést na řádek, i když je firmware dodán bez symbolů. To je také další důvod pro [reprodukovatelný build](/blog/reproducible-builds-embedded): adresa něco znamená jen pro přesně ten binární soubor, který ji vytvořil.
3. **Povolte jemnější chyby** (bity v `SHCSR`), když chcete mít handlery `UsageFault`, `BusFault` a `MemManage` zvlášť. Zpráva je pak bohatší, protože stavové registry nejsou sdílené.
4. **Ukládejte zprávu do paměti, která přežije reset** (sekce, kterou startup kód nemaže, viz článek o tom, [co se děje před `main()`](/blog/before-main-startup-linker)), proveďte reset a po restartu ji odešlete. Zpráva ze zařízení v provozu má větší cenu než sto dohadů.
5. **Předcházejte tomu, co jde.** Volání `NULL` v příkladu je vada, kterou by zachytila [pravidla MISRA](/blog/misra-c-rules-in-practice) a unit test modulu (ukazatel musí být nastaven před prvním voláním), a přetečení zásobníku je věc, pro kterou je nutné znát využití zásobníku (pravidlo proti rekurzi).

## Stejná session na desce

Použil jsem QEMU, protože nepotřebuje desku, a jeho GDB server (`-S -gdb tcp::1234`) se chová stejně jako server debug probe: příkazy v příkladech jsou příkazy, které zadáváte i s probe. Platforma má artefakt pro sadu nástrojů **probe-rs** (ladicí sada pro cíle ARM přes debug probe, se serverem DAP), což je způsob, jak připojit GDB nebo IDE ke skutečné desce. Pro tento článek jsem ho nespouštěl, protože ve svém prostředí probe nemám.

## Shrnutí

1. HardFault není záhada: jádro uložilo registry a nastavilo stavové bity.
2. Handler musí najít správný zásobník (`EXC_RETURN`) a přečíst rámec, `CFSR`, `HFSR` a `BFAR`.
3. `PC` a `LR` dávají místo, `CFSR` druh chyby, `BFAR` adresu.
4. `PC = 0` s `INVSTATE` je skok na `NULL` a bit `T` v `xPSR` to ukazuje.
5. Uchovejte `.elf` a adresa ze zprávy z provozu se promění v řádek kódu.

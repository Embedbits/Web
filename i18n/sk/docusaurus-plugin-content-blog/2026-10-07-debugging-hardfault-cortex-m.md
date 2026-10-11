---
title: "Ladenie HardFaultu na Cortex-M: od záhady k riadku kódu"
slug: debugging-hardfault-cortex-m
date: 2026-10-07T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Každý vývojár embedded systémov pozná ten okamih: firmvér bežal a zrazu už nebeží. Debugger ukazuje, že program sedí v nekonečnej slučke s názvom ako `HardFault_Handler` alebo `Default_Handler`, a zásobník volaní tvorí niekoľko nezmyselných rámcov. Tá slučka je **predvolený** handler zo startup kódu a o tom, čo sa stalo, nehovorí vôbec nič. Porucha má príčinu a procesor si ju už zapísal: do ôsmich registrov na zásobníku a do štyroch stavových registrov. Stačí ich len prečítať.

Tento článok ukazuje, ako z tej slučky získať riadok zdrojového kódu, na dvoch reálnych príkladoch, ktoré som spustil v QEMU (model dosky s STM32F4) a preskúmal pomocou GDB: volanie `NULL` ukazovateľa na funkciu a zápis na adresu, kde nie je nič. Všetky výstupy sú skutočné.

<!-- truncate -->

## Čo robí jadro, keď nastane porucha

Procesor Cortex-M sa nezrúti potichu. Keď nemôže pokračovať (neplatná inštrukcia, chyba zbernice, nepovolený prístup), spracuje **výnimku** a urobí dve veci, ktoré sú pre ladenie dôležité:

1. **Uloží osem registrov na zásobník**: `R0`, `R1`, `R2`, `R3`, `R12`, `LR`, `PC` a `xPSR`. Uložený `PC` je inštrukcia, ktorá spôsobila poruchu, a uložený `LR` hovorí, kto zavolal funkciu, v ktorej porucha nastala.
2. Nastaví **bity v stavových registroch porúch**, ktoré hovoria, o aký druh poruchy išlo: `CFSR` (konfigurovateľný stav porúch, zložený z troch častí pre poruchy pamäte, zbernice a použitia), `HFSR` (stav hard fault) a adresové registre `MMFAR` a `BFAR` s adresou, ku ktorej sa pristupovalo.

Poruchy pamäte, zbernice a použitia (usage fault) majú vlastné handlery, ale po resete sú **vypnuté**, takže každá porucha je *eskalovaná* na HardFault. Preto jeden handler vidí všetko a bit `FORCED` v `HFSR` hovorí, že sa tak stalo.

## Handler, ktorý číta registre

Jediná ťažkosť je dostať sa k zásobníku, kde registre sú. Jadro má dva ukazovatele zásobníka (`MSP` pre výnimky a hlavný kód, `PSP` pre úlohy operačného systému) a bit 2 hodnoty v `LR` pri vstupe do výnimky hovorí, ktorý z nich bol použitý. Musí sa to urobiť *predtým*, než kompilátor použije zásobník na vlastné účely, takže handler je krátka funkcia v assembleri (`naked`: bez prológu), ktorá odovzdá ukazovateľ funkcii v C:

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

Pozrite sa na tri časti. Štruktúra `stackFrame_t` je rozloženie ôsmich registrov v poradí, v akom ich jadro ukladá. Funkcia `HardFault_Report()` ich (spolu so stavovými registrami) skopíruje do globálnej premennej `faultInfo`, vypíše krátku správu a potom **zámerne zostane v slučke**, aby sa mohol pripojiť debugger a pozrieť sa na túto premennú. Assemblerový stub vyberie správny zásobník a skočí na ňu. V produkte by sa správa zapísala do pamäte, ktorá prežije reset, a firmvér by sa sám resetoval, ale princíp je rovnaký.

## Príklad 1: volanie `NULL` ukazovateľa

Toto je aplikácia s chybou. Callback sa zaregistruje neskôr, ale kód, ktorý ho volá, sa spustí skôr:

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

Program vypíše `start` a potom správu:

```text
start
*** HardFault ***
PC    0x00000000
LR    0x08000115
xPSR  0x60000000
CFSR  0x00020000
HFSR  0x40000000
```

A teraz jej čítanie, hodnotu po hodnote:

- **`PC = 0x00000000`**: procesor sa pokúsil vykonať inštrukciu na adrese nula. Takmer vždy to znamená skok cez `NULL` ukazovateľ na funkciu alebo návrat na poškodenú adresu.
- **`CFSR = 0x00020000`**: bit 17 je `INVSTATE`, „neplatný stav". Procesor sa pokúsil vykonávať kód v stave ARM, ktorý Cortex-M nemá. Dôvod je v **`xPSR`**: jeho bit 24 je bit `T` (Thumb) a tu je nulový (`0x60000000`). Adresa funkcie v Thumb móde má najnižší bit nastavený, `NULL` nie, takže skok cez ukazovateľ vynuloval bit `T`. Nulový bit `T` je typický odtlačok skoku na `NULL`.
- **`HFSR = 0x40000000`**: bit 30 je `FORCED`, porucha bola eskalovaná na HardFault z usage fault, ktorý nie je povolený.
- **`LR = 0x08000115`**: návratová adresa s nastaveným najnižším bitom (Thumb). Je to adresa **volajúceho**, `0x08000114`, a práve tam je chyba.

S debuggerom trvá posledný krok pár sekúnd. QEMU čaká na GDB (`-S -gdb tcp::1234`) a session vyzerá takto:

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

`info symbol` dá funkciu, `list *` dá riadok (ten *za* volaním, pretože to je návratová adresa) a disassembler ukáže dvojicu inštrukcií, ktorá je samotnou chybou: načítanie nuly do `r3` a `blx r3`, volanie cez register, ktorý obsahuje `NULL`. Všimnite si `r3 = 0x0` v uložených registroch. Bez debuggera je rovnaká odpoveď jedným príkazom toolchainu, ktorý potrebuje len adresu zo správy a súbor s ladiacimi informáciami (`-g`):

```text
$ arm-none-eabi-addr2line -e fault.elf -f 0x08000114
Button_Pressed
fault.c:87
```

## Príklad 2: zápis na adresu, kde nie je nič

Zmenil som jeden riadok aplikácie: namiesto callbacku funkcia zapisuje na adresu `0xA0000000`, kde v modeli čipu nie je namapované nič. Správa:

```text
*** HardFault ***
PC    0x08000124
LR    0x08000199
xPSR  0x21000000
CFSR  0x00008200
HFSR  0x40000000
```

Tentoraz je `PC` **platná adresa vo flash**, bit `T` je nastavený (`0x21000000`) a `CFSR` je iný: `0x8200` sú dva bity, 9 (`PRECISERR`, presná chyba dátovej zbernice) a 15 (`BFARVALID`, register `BFAR` obsahuje adresu). V GDB:

```text
(gdb) print/x faultInfo.cfsr
$1 = 0x8200
(gdb) print/x faultInfo.bfar
$2 = 0xa0000000
(gdb) info symbol faultInfo.frame.pc
main + 12 in section .text
```

`BFAR` je adresa, na ktorú sa program pokúsil zapisovať, `PC` je inštrukcia, ktorá to skúsila. Spolu hovoria „táto inštrukcia zapisovala na túto adresu", čo je úplný popis problému. Ak je adresa malá (`0x00000008`), ide o `NULL` ukazovateľ na štruktúru a pristupujete k jej členu. Ak vyzerá ako dáta (`0x20000000` a o niečo viac), ide o zásobník alebo buffer, ktorý ste pretiahli.

## Bity CFSR, s ktorými sa stretnete

Register je kombináciou troch registrov (každý z nich má vlastný bajt alebo dva bajty). Toto sú tie, ktoré uvidíte najčastejšie (dva, ktoré som pozoroval v príkladoch, sú zvýraznené):

| Bit | Názov | Význam |
|---|---|---|
| 0 | `IACCVIOL` | načítanie inštrukcie z oblasti, ktorá nie je povolená (MPU) |
| 1 | `DACCVIOL` | dátový prístup do oblasti, ktorá nie je povolená (MPU) |
| 7 | `MMARVALID` | register `MMFAR` obsahuje adresu |
| 8 | `IBUSERR` | chyba zbernice pri načítaní inštrukcie |
| **9** | **`PRECISERR`** | **presná chyba zbernice pri dátovom prístupe: `PC` je inštrukcia, ktorá ju spôsobila** |
| 10 | `IMPRECISERR` | nepresná chyba zbernice: inštrukcia je už preč, `PC` nie je spoľahlivý |
| 11, 12 | `UNSTKERR`, `STKERR` | chyba zbernice pri vyberaní alebo ukladaní registrov (často poškodený zásobník) |
| **15** | **`BFARVALID`** | **register `BFAR` obsahuje adresu** |
| 16 | `UNDEFINSTR` | nedefinovaná inštrukcia (vykonávanie dát, poškodený kód) |
| **17** | **`INVSTATE`** | **pokus o vykonávanie v stave ARM: skok na adresu s vynulovaným bitom 0** |
| 18 | `INVPC` | neplatný `EXC_RETURN` (poškodený zásobník výnimky) |
| 19 | `NOCP` | prístup ku koprocesoru, ktorý nie je povolený (typicky FPU, ktorá nebola zapnutá) |
| 24 | `UNALIGNED` | nezarovnaný prístup, keď je povolená pasca |
| 25 | `DIVBYZERO` | delenie nulou, keď je povolená pasca |

## Čo zvyčajne stojí za HardFaultom

| Čo vidíte | Čo to zvyčajne je |
|---|---|
| `PC = 0`, `INVSTATE` | volanie cez `NULL` ukazovateľ na funkciu alebo návrat na poškodenú adresu |
| `PRECISERR` a malé `BFAR` | `NULL` ukazovateľ na štruktúru |
| `PRECISERR` a `BFAR` v rozsahu adries periférií | prístup k periférii, ktorá nie je dostupná, napríklad takej, ktorej hodiny neboli zapnuté (na niektorých rodinách je takýto prístup chybou zbernice, na iných sa potichu ignoruje) |
| `STKERR` / `UNSTKERR` alebo `PC`, ktorý nedáva zmysel | pretečenie zásobníka alebo bufferu, ktoré poškodilo návratovú adresu |
| `NOCP` pri prvej inštrukcii s pohyblivou desatinnou čiarkou | FPU nebola povolená v startup kóde |
| `IMPRECISERR` | zápis, ktorý prešiel cez write buffer: správa o poruche prichádza neskôr než inštrukcia. Na ladenie možno buffering vypnúť (bit `DISABLEDEFWRITEBUF` v `ACTLR`), takže porucha bude presná |

Prvý riadok tabuľky a princíp druhého (chyba zbernice s adresou v `BFAR`) som predviedol. Zvyšné riadky sú zhrnutím obvyklých príčin, vyplývajú z významu bitov v referenčnej príručke jadra.

## V praxi

1. **Nikdy nenechávajte predvolený handler ako prázdnu slučku.** Handler vyššie má asi tridsať riadkov a mení poruchu na správu s miestom v kóde. Vložte ho raz do startup kódu projektu.
2. **Uchovávajte ladiace informácie** v súbore, ktorý archivujete s vydaním (`-g` a `.elf`), aby sa adresa zo správy z terénu dala premeniť na riadok, aj keď sa firmvér dodáva stripnutý. Je to ďalší dôvod pre [reprodukovateľný build](/blog/reproducible-builds-embedded): adresa niečo znamená len pre presný binárny súbor, ktorý ju vytvoril.
3. **Povoľte jemnejšie poruchy** (bity v `SHCSR`), keď chcete samostatné handlery `UsageFault`, `BusFault` a `MemManage`. Správa je bohatšia, pretože stavové registre sa nezdieľajú.
4. **Uložte správu do pamäte, ktorá prežije reset** (sekcia, ktorú startup kód nemaže, pozrite článok o tom, [čo sa stane pred `main()`](/blog/before-main-startup-linker)), resetujte a odošlite ju po reštarte. Správa zo zariadenia v teréne má väčšiu hodnotu než sto dohadov.
5. **Predchádzajte tomu, čomu sa dá.** Volanie `NULL` v príklade je chyba, ktorú by zachytili [pravidlá MISRA](/blog/misra-c-rules-in-practice) a unit test modulu (ukazovateľ musí byť nastavený pred prvým volaním), a pretečenie zásobníka je vec, pri ktorej treba poznať využitie zásobníka (pravidlo proti rekurzii).

## Rovnaká session na doske

Použil som QEMU, pretože nepotrebuje dosku, a jeho server GDB (`-S -gdb tcp::1234`) sa správa rovnako ako ten, ktorý poskytuje debug probe: príkazy v príkladoch sú príkazy, ktoré zadáte s probe. Platforma má artefakt pre sadu nástrojov **probe-rs** (ladiaca sada pre ARM ciele cez debug probe, so serverom DAP), čo je spôsob, ako pripojiť GDB alebo IDE ku skutočnej doske. Pre tento článok som ho nespúšťal, keďže vo svojom prostredí nemám probe.

## Zhrnutie

1. HardFault nie je záhada: jadro uložilo registre a nastavilo stavové bity.
2. Handler musí nájsť správny zásobník (`EXC_RETURN`) a prečítať rámec, `CFSR`, `HFSR` a `BFAR`.
3. `PC` a `LR` dávajú miesto, `CFSR` dáva druh, `BFAR` dáva adresu.
4. `PC = 0` s `INVSTATE` je skok na `NULL` a bit `T` v `xPSR` to ukazuje.
5. Uchovajte si `.elf` a adresa z hlásenia z terénu sa zmení na riadok kódu.

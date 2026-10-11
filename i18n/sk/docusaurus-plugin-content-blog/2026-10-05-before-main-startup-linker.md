---
title: "Čo sa stane pred main(): reset, startup kód a linker script"
slug: before-main-startup-linker
date: 2026-10-05T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Každý tutoriál jazyka C začína `int main(void)`. Nikto však nevysvetlí, kto túto funkciu volá. A pritom, keď napíšete `uint32_t counter = 5;` ako globálnu premennú a prvý riadok `main()` prečíta hodnotu 5, už sa vykonalo veľa práce. Ak sa táto práca nevykoná, prejaví sa to premennou s náhodnou hodnotou, ktorá „včera fungovala".

V tomto článku budeme sledovať mikrokontrolér od resetu až po prvý riadok `main()`: čo robí hardvér sám od seba, čo hovorí linker script a čo musí urobiť startup kód. Je to obsah dvoch modulov Embedbits BSP ([Linker](/docs/bsp/linker) a [Startup](/docs/bsp/startup)), ale princíp je rovnaký na každom Cortex-M. Všetok kód v článku bol zostavený pomocou `arm-none-eabi-gcc` 13.2.1 a **spustený** v QEMU, na modeli dosky s STM32F405, takže adresy a výstupy sú skutočné.

<!-- truncate -->

## Čo od programu očakáva jazyk C

Norma jazyka C sľubuje o programe niekoľko vecí, o ktorých hardvér nevie:

- globálna premenná s inicializátorom (`uint32_t initializedValue = 0x12345678u;`) má na začiatku túto hodnotu,
- globálna alebo `static` premenná bez inicializátora je **nulová**,
- existuje zásobník (stack) a funkcia ho môže používať,
- globálne objekty C++ sú skonštruované (a v jazyku C sa spustia funkcie označené `__attribute__((constructor))`) ešte pred `main()`.

Hardvér ponúka veľmi málo. Jadro Cortex-M po resete robí len dve veci: z prvého slova vektorovej tabuľky načíta **počiatočnú hodnotu ukazovateľa zásobníka**, z druhého **adresu reset handlera** a skočí tam. Všetko ostatné je úloha startup kódu, ktorý je súčasťou **vášho** firmvéru.

## Vektorová tabuľka

Vektorová tabuľka je pole adries umiestnené na začiatku flash pamäte (na STM32 je to `0x08000000`, čo je po štarte z flash viditeľné aj na adrese 0). V minimálnej podobe obsahuje ukazovateľ zásobníka, reset handler a handlery výnimiek:

```c
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,   /* [0] initial stack pointer */
    Reset_Handler,              /* [1] where the core jumps after the reset */
    NMI_Handler,
    HardFault_Handler,
};
```

Toto obsahuje prvých 16 bajtov zostaveného firmvéru:

```text
Contents of section .isr_vector:
 8000000 00000220 13000008 11000008 11000008
```

Čísla sú v poradí little-endian. Prvé slovo je `0x20020000`, koniec 128 kB RAM, ktorá začína na `0x20000000`, a práve tu začína zásobník (rastie smerom nadol). Druhé je `0x08000013`: reset handler leží na adrese `0x08000012` a najnižší bit hovorí „Thumb kód", čo je na Cortex-M povinné. Zvyšok sú výnimky; všetky nepoužité som nasmeroval na ten istý handler.

## Linker script: mapa pamäte

Kompilátor vytvára objektové súbory so sekciami (`.text` pre kód, `.data`, `.bss` a podobne) a netuší, kde v pamäti skončia. Rozhoduje o tom linker a potrebuje na to mapu. Toto je celý skript z príkladu, 59 riadkov:

```text title="link.ld"
/* Entry point: the first instruction that runs after the reset */
ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
  RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 128K
}

/* The stack grows down from the end of the RAM */
_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
  /* The vector table has to be at the very beginning of the flash */
  .isr_vector :
  {
    KEEP(*(.isr_vector))
  } > FLASH

  .text :
  {
    *(.text*)
    *(.rodata*)
    . = ALIGN(4);
  } > FLASH

  /* Constructors of the C++ objects and functions marked as constructor */
  .init_array :
  {
    . = ALIGN(4);
    __init_array_start = .;
    KEEP(*(.init_array*))
    __init_array_end = .;
  } > FLASH

  /* Start of the initial values of .data: in the flash, right after the code */
  _sidata = LOADADDR(.data);

  /* .data lives in the RAM (VMA), its initial values are stored in the flash (LMA) */
  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM
}
```

Prejdime si dôležité časti.

**`MEMORY`** popisuje fyzické pamäte: kde začínajú a aké sú veľké. Atribúty hovoria linkeru, čo tam je povolené (`rx`: čítanie a vykonávanie, `xrw`: všetko).

**`.isr_vector` ide ako prvá** do flash pamäte a `KEEP` bráni linkeru, aby ju zahodil: nič v kóde túto tabuľku *nevolá*, takže bez `KEEP` by vyzerala ako nepoužitá. Nasleduje `.text` s kódom a dátami len na čítanie (`.rodata`, čo znamená, že `const` premenné zostávajú vo flash a nezaberajú žiadnu RAM).

**`.data` je tá zaujímavá.** Pozrite sa na riadok `} > RAM AT > FLASH`. Každá sekcia má dve adresy:

- **VMA** (virtual memory address), kde sa sekcia nachádza, keď program *beží*: `.data` musí byť v RAM, pretože sa do nej zapisuje,
- **LMA** (load address), kde je sekcia *uložená* v obraze firmvéru: RAM je po zapnutí prázdna, takže počiatočné hodnoty musia byť niekde, kde prežijú, teda vo flash.

`arm-none-eabi-objdump -h` ukáže obe:

```text
Idx Name          Size      VMA       LMA       File off  Algn
  0 .isr_vector   00000010  08000000  08000000  00001000  2**2
  1 .text         000001b0  08000010  08000010  00001010  2**2
  2 .init_array   00000004  080001c0  080001c0  000011c0  2**2
  3 .data         00000004  20000000  080001c4  00002000  2**2
  4 .bss          00000008  20000004  080001c8  00002004  2**2
```

`.data` sídli na `0x20000000`, ale jej počiatočné hodnoty sú vo flash na `0x080001C4`. Niekto ich musí skopírovať, a preto skript definuje symboly `_sidata` (zdroj vo flash), `_sdata` a `_edata` (začiatok a koniec cieľa v RAM). Za týmito symbolmi nie je žiadna pamäť, sú to len adresy, ktoré kód v C načíta cez `&_sdata`:

```text
080001c4 A _sidata
20000000 D _sdata
20000004 D _edata
20000004 B _sbss
2000000c B _ebss
20020000 R _estack
```

**`.bss` je `NOLOAD`.** V obraze nemá žiadny obsah, len veľkosť (premenná bez inicializátora s nulovou hodnotou by zbytočne plytvala flash pamäťou). Startup kód musí oblasť medzi `_sbss` a `_ebss` vyplniť nulami.

**`.init_array`** je tabuľka ukazovateľov na konštruktory. Startup kód ju prejde a konštruktory zavolá.

Linker script v Embedbits BSP generuje CMake pre každý MCU zo šablóny. Obsahuje rovnaké symboly (`_sidata`, `_sdata`, `_edata`, `_sbss`, `_ebss`, `_stack_top`) a popisuje aj voliteľné oblasti, napríklad CCMRAM na STM32G4, kde možno umiestniť sekciu `.ccmram`.

## Startup kód

Skript povedal, kde je všetko uložené, a teraz kód urobí to, čo od programu očakáva jazyk C:

```c title="startup.c"
#include <stdint.h>

/* Symbols created by the linker script */
extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);

int main(void);
void Reset_Handler(void);
void Default_Handler(void);

/* A few of the exception handlers, all unused ones point to the default one */
void NMI_Handler(void)       __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));

/* The vector table: the first word is the initial stack pointer, the second the reset handler */
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
};

void Reset_Handler(void)
{
#ifdef DEMO_DIRTY_RAM
    /* Only for the demo: RAM full of garbage, as after a reset of a running system.
     * The upper 4 kB are left alone, the stack of this function lives there. */
    for (uint32_t *ramWord = &_sdata; ramWord < (uint32_t *)((uintptr_t)&_estack - 0x1000u); ramWord++)
    {
        *ramWord = 0xA5A5A5A5u;
    }
#endif

#ifndef DEMO_SKIP_INIT
    /* 1. Copy the initial values of .data from the flash to the RAM */
    uint32_t *source = &_sidata;
    for (uint32_t *target = &_sdata; target < &_edata; )
    {
        *target++ = *source++;
    }

    /* 2. Zero the .bss */
    for (uint32_t *target = &_sbss; target < &_ebss; )
    {
        *target++ = 0u;
    }
#endif

    /* 3. Run the constructors */
    for (void (**constructor)(void) = __init_array_start; constructor < __init_array_end; constructor++)
    {
        (*constructor)();
    }

    /* 4. Hand over to the application */
    (void)main();

    for (;;) { }
}

void Default_Handler(void)
{
    for (;;) { }
}
```

`Reset_Handler` má štyri kroky (časti s `#ifdef` slúžia na nižšie uvedený experiment):

1. **Skopírovať `.data`** z flash (`_sidata`) do RAM (`_sdata` až `_edata`).
2. **Vynulovať `.bss`** (`_sbss` až `_ebss`).
3. **Zavolať konštruktory** z `.init_array`.
4. **Zavolať `main()`**. Ak sa niekedy vráti, program zostane v nekonečnej slučke, pretože nie je kam sa vrátiť.

V Embedbits BSP robí startup modul podľa svojej dokumentácie o niečo viac: nastaví aj hodiny (RCC cez MCAL) a potom zavolá `AppMain()`. Z poradia krokov vyplýva pravidlo: **čokoľvek, čo sa vykoná pred krokmi 1 a 2, sa nesmie dotknúť globálnej premennej**, pretože jej obsah ešte nie je platný. Nastavenie hodín je preto funkcia, ktorá používa iba registre, alebo si kompilátor drží jej stav v lokálnych premenných.

## Experiment: čo sa stane bez toho

Aplikácia z príkladu má štyri globálne premenné štyroch druhov:

```c title="main.c"
uint32_t initializedValue = 0x12345678u;       /* .data: has a value in the flash */
uint32_t zeroedValue;                          /* .bss:  has to be zero            */
const uint32_t constantValue = 0xC0FFEE00u;    /* .rodata: stays in the flash      */
uint32_t constructedValue;                     /* set by a constructor before main */

__attribute__((constructor)) static void Construct(void)
{
    constructedValue = 0xC0DE0001u;
}

int main(void)
{
    PrintHex("initializedValue", initializedValue);
    PrintHex("zeroedValue      ", zeroedValue);
    PrintHex("constantValue    ", constantValue);
    PrintHex("constructedValue ", constructedValue);
    PrintHex("address of initializedValue", (uint32_t)&initializedValue);
    PrintHex("address of constantValue   ", (uint32_t)&constantValue);
    Quit();
    return 0;
}
```

(Časť nad týmto kódom, s funkciami, ktoré tlačia cez *semihosting*, je niekoľko riadkov kódu, ktoré požiadajú QEMU, aby vypísal text a skončil. Pre túto tému nie je dôležitá.)

Najprv bežný build. Výsledok:

```text
initializedValue 0x12345678
zeroedValue       0x00000000
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
address of initializedValue 0x20000000
address of constantValue    0x080001BC
```

Všetky štyri hodnoty sú také, aké sľubuje jazyk C, a adresy potvrdzujú príbeh: premenná v RAM je na `0x2000...`, konštanta vo flash na `0x0800...`.

Teraz experiment. Po resete bežiaceho systému RAM nie je prázdna: obsahuje to, čo tam bolo predtým. Studený štart MCU je často „šťastný", pretože RAM je náhodou nulová, a chyba v startup kóde tak zostane dlho skrytá. Na test som RAM znečistil (`-DDEMO_DIRTY_RAM` ju pred všetkým ostatným vyplní hodnotou `0xA5A5A5A5`) a potom som odstránil kroky 1 a 2 (`-DDEMO_SKIP_INIT`):

```bash
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostartfiles \
    -T link.ld -DDEMO_DIRTY_RAM -DDEMO_SKIP_INIT startup.c main.c -o broken.elf
qemu-system-arm -M netduinoplus2 -nographic \
    -semihosting-config enable=on,target=native -kernel broken.elf
```

```text
initializedValue 0xA5A5A5A5
zeroedValue       0xA5A5A5A5
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
```

Pozrite sa, čo je zlé a čo nie:

- `initializedValue` a `zeroedValue` sú nezmysel. Prvá nemá počiatočnú hodnotu, druhá nie je nulová, hoci oba riadky v súbore C hovoria opak.
- `constantValue` je v poriadku, pretože je vo flash a nikto ju nemusí kopírovať.
- `constructedValue` je v poriadku, pretože ju konštruktor zapísal *po* (chýbajúcej) inicializácii. Preto je tento druh chyby taký ťažko odhaliteľný: jedna polovica programu funguje a druhá má náhodné hodnoty.

S znečistenou RAM a kompletným startup kódom vypíše ten istý program opäť správne hodnoty.

## Ako to vyzerá v praxi

Niekoľko príznakov a to, čo za nimi zvyčajne stojí:

| Príznak | Pravdepodobná príčina |
|---|---|
| Program padne do HardFault hneď po resete | Prvé slovo vektorovej tabuľky nie je platná adresa zásobníka (nesprávne `_estack`, nesprávna veľkosť RAM) alebo tabuľka nie je na začiatku flash |
| Globálna premenná s inicializátorom má nesprávnu hodnotu, aj tá s `= 0` | `.data` sa nekopíruje alebo `.bss` sa nenuluje (nesprávny symbol, sekcia, ktorá v skripte chýba) |
| Funguje po zapnutí napájania a zlyháva po resete | To isté, RAM bola po zapnutí náhodou prázdna |
| Zvláštna hodnota, ktorá sa mení s veľkosťou kódu | Zásobník rastie nadol do `.bss` / `.data`, pretečenie zásobníka |
| Prvý `printf` alebo ovládač nefunguje | Kód, ktorý sa vykoná pred krokmi 1 a 2, používa globálnu premennú |

### Čo vám hovoria čísla nástroja

```text
   text	   data	    bss	    dec	    hex	filename
    448	      8	      8	    464	    1d0	good.elf
```

- **Flash** = `text` + `data`. Počiatočné hodnoty `.data` zaberajú miesto aj vo flash, takže veľké inicializované pole vás stojí dvakrát: vo flash aj v RAM. Pole, ktoré sa nemení, by malo byť `const` a potom je len vo flash.
- **RAM** = `data` + `bss` (+ zásobník a halda).

Skontrolovať to vie aj linker, `-Wl,--print-memory-usage` vypíše, koľko z každej oblasti je využitých:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         456 B         1 MB      0.04%
             RAM:          12 B       128 KB      0.01%
```

Pridajte tento prepínač do svojho buildu a keď je niečo na neočakávanom mieste, prečítajte si súbor `.map` (`-Wl,-Map,out.map`): obsahuje adresu každej funkcie a každej premennej.

## Zhrnutie

1. Po resete jadro načíta dve slová: ukazovateľ zásobníka a adresu reset handlera. Všetko ostatné je váš kód.
2. **Linker script** je mapa: kde sú pamäte, v akom poradí ležia sekcie a ktoré symboly označujú ich hranice.
3. **Startup kód** je to, čo robí sľuby jazyka pravdivými: kopíruje `.data`, nuluje `.bss`, spúšťa konštruktory a volá `main()`.
4. Premenná, ktorá má hodnotu vo flash a žije v RAM, má dve adresy, load address a run address. Toto je kľúč k celej téme.
5. Majte zapnuté `-Wl,--print-memory-usage` a čítajte `arm-none-eabi-size` a map súbor. Povedia vám o tom, kam sa podela vaša pamäť, viac než debugger.

V Embedbits BSP tieto dva súbory nepíšete sami: linker script sa generuje pre vybraný MCU a startup kód prichádza s vetvou BSP pre danú rodinu. Napriek tomu sa oplatí pochopiť, čo robia, pretože keď firmvér nenaštartuje, nikto iný vám nepomôže.

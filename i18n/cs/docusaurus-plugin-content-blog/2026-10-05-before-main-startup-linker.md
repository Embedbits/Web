---
title: "Co se děje před main(): reset, startup kód a linker script"
slug: before-main-startup-linker
date: 2026-10-05T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Každý tutoriál jazyka C začíná `int main(void)`. Nikdo ale nevysvětluje, kdo ji volá. A přitom když napíšete `uint32_t counter = 5;` jako globální proměnnou a první řádek `main()` přečte 5, už se odvedlo hodně práce. Když se ta práce neodvede, projeví se to proměnnou s náhodnou hodnotou, která „včera fungovala".

V tomto článku budeme sledovat mikrokontrolér od resetu až po první řádek `main()`: co udělá hardware sám, co říká linker script a co musí udělat startup kód. Jde o obsah dvou modulů Embedbits BSP ([Linker](/docs/bsp/linker) a [Startup](/docs/bsp/startup)), ale princip je stejný na každém Cortex-M. Veškerý kód v článku byl přeložen pomocí `arm-none-eabi-gcc` 13.2.1 a **spuštěn** v QEMU na modelu desky se STM32F405, takže adresy i výstupy jsou skutečné.

<!-- truncate -->

## Co jazyk C očekává

Standard jazyka C slibuje o programu několik věcí, o kterých hardware nic neví:

- globální proměnná s inicializátorem (`uint32_t initializedValue = 0x12345678u;`) má na začátku tuto hodnotu,
- globální nebo `static` proměnná bez inicializátoru je **nulová**,
- existuje zásobník a funkce ho může používat,
- globální objekty C++ jsou zkonstruovány (a v C se před `main()` spustí funkce označené `__attribute__((constructor))`).

Hardware vám dává velmi málo. Po resetu jádro Cortex-M udělá jen dvě věci: z prvního slova vektorové tabulky načte **počáteční hodnotu ukazatele zásobníku**, z druhého **adresu reset handleru**, a skočí tam. Vše ostatní je úkolem startup kódu, který je součástí **vašeho** firmwaru.

## Vektorová tabulka

Vektorová tabulka je pole adres umístěné na začátku flash paměti (u STM32 je to `0x08000000`, což je po bootu z flash vidět i na adrese 0). V minimální podobě obsahuje ukazatel zásobníku, reset handler a handlery výjimek:

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

Takto vypadají prvních 16 bajtů přeloženého firmwaru:

```text
Contents of section .isr_vector:
 8000000 00000220 13000008 11000008 11000008
```

Čísla jsou v pořadí little-endian. První slovo je `0x20020000`, konec 128 kB RAM, která začíná na `0x20000000`, tedy místo, kde začíná zásobník (roste směrem dolů). Druhé je `0x08000013`: reset handler leží na `0x08000012` a nejnižší bit říká „Thumb kód", což je na Cortex-M povinné. Zbytek jsou výjimky; všechny nepoužité jsem nasměroval na stejný handler.

## Linker script: mapa paměti

Překladač vytváří objektové soubory se sekcemi (`.text` pro kód, `.data`, `.bss` a tak dále) a netuší, kde v paměti skončí. To rozhoduje linker a potřebuje k tomu mapu. Tady je celý skript z příkladu, 59 řádků:

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

Přečtěme si důležité části.

**`MEMORY`** popisuje fyzické paměti: kde začínají a jak jsou velké. Atributy říkají linkeru, co je tam povoleno (`rx`: čtení a spouštění, `xrw`: všechno).

**`.isr_vector` jde do flash jako první** a `KEEP` brání linkeru, aby ji zahodil: nic v kódu tabulku *nevolá*, takže by bez `KEEP` vypadala nepoužitá. Následuje `.text` s kódem a daty jen pro čtení (`.rodata`, tedy proměnné `const` zůstávají ve flash a nespotřebují žádnou RAM).

**`.data` je ta zajímavá.** Podívejte se na řádek `} > RAM AT > FLASH`. Každá sekce má dvě adresy:

- **VMA** (virtual memory address), kde sekce je, když program *běží*: `.data` musí být v RAM, protože se do ní zapisuje,
- **LMA** (load address), kde je sekce *uložena* v obrazu firmwaru: RAM je po zapnutí napájení prázdná, takže počáteční hodnoty musí ležet někde, kde přežijí, ve flash.

`arm-none-eabi-objdump -h` ukáže obě:

```text
Idx Name          Size      VMA       LMA       File off  Algn
  0 .isr_vector   00000010  08000000  08000000  00001000  2**2
  1 .text         000001b0  08000010  08000010  00001010  2**2
  2 .init_array   00000004  080001c0  080001c0  000011c0  2**2
  3 .data         00000004  20000000  080001c4  00002000  2**2
  4 .bss          00000008  20000004  080001c8  00002004  2**2
```

`.data` leží na `0x20000000`, ale její počáteční hodnoty jsou ve flash na `0x080001C4`. Někdo je musí zkopírovat, a proto skript definuje symboly `_sidata` (zdroj ve flash), `_sdata` a `_edata` (začátek a konec cíle v RAM). Tyto symboly nemají za sebou žádnou paměť, jsou to pouze adresy, které kód v C čte pomocí `&_sdata`:

```text
080001c4 A _sidata
20000000 D _sdata
20000004 D _edata
20000004 B _sbss
2000000c B _ebss
20020000 R _estack
```

**`.bss` je `NOLOAD`.** V obrazu nemá žádný obsah, jen velikost (proměnná bez inicializátoru s nulovou hodnotou by zbytečně plýtvala flash). Startup kód musí oblast mezi `_sbss` a `_ebss` vyplnit nulami.

**`.init_array`** je tabulka ukazatelů na konstruktory. Startup kód ji projde a konstruktory zavolá.

Linker script v Embedbits BSP generuje CMake pro každé MCU ze šablony. Má stejné symboly (`_sidata`, `_sdata`, `_edata`, `_sbss`, `_ebss`, `_stack_top`) a popisuje i volitelné oblasti, například CCMRAM u STM32G4, kam lze umístit sekci `.ccmram`.

## Startup kód

Skript řekl, kde všechno je, a teď kód udělá to, co jazyk C očekává:

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

`Reset_Handler` má čtyři kroky (části s `#ifdef` jsou pro experiment níže):

1. **Zkopíruje `.data`** z flash (`_sidata`) do RAM (`_sdata` až `_edata`).
2. **Vynuluje `.bss`** (`_sbss` až `_ebss`).
3. **Zavolá konstruktory** z `.init_array`.
4. **Zavolá `main()`**. Pokud by se někdy vrátila, program zůstane v nekonečné smyčce, protože není kam se vrátit.

V Embedbits BSP dělá startup modul podle své dokumentace o něco víc: nastaví také hodiny (RCC přes MCAL) a poté zavolá `AppMain()`. Z pořadí plyne pravidlo: **cokoli se spouští před kroky 1 a 2, nesmí sahat na globální proměnnou**, protože její obsah ještě není platný. Nastavení hodin je funkce, která používá jen registry, nebo si překladač drží stav v lokálních proměnných.

## Experiment: co se stane bez toho

Aplikace v příkladu má čtyři globální proměnné čtyř druhů:

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

(Část nad tímto, s funkcemi tisknoucími přes *semihosting*, je pár řádků kódu, které žádají QEMU o vypsání textu a o ukončení. Pro téma není důležitá.)

Nejdřív normální build. Výsledek:

```text
initializedValue 0x12345678
zeroedValue       0x00000000
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
address of initializedValue 0x20000000
address of constantValue    0x080001BC
```

Všechny čtyři hodnoty jsou takové, jak jazyk C slibuje, a adresy potvrzují celý příběh: proměnná v RAM je na `0x2000...`, konstanta ve flash na `0x0800...`.

Teď experiment. Po resetu běžícího systému není RAM prázdná: obsahuje to, co v ní bylo předtím. Studený start MCU je často „šťastný", protože RAM je náhodou nulová, a chyba ve startup kódu pak zůstane dlouho skrytá. Pro test jsem RAM znečistil (`-DDEMO_DIRTY_RAM` ji před čímkoli jiným naplní hodnotou `0xA5A5A5A5`) a potom jsem odstranil kroky 1 a 2 (`-DDEMO_SKIP_INIT`):

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

Podívejte se, co je špatně a co ne:

- `initializedValue` a `zeroedValue` jsou smetí. První nemá počáteční hodnotu, druhá není nulová, přestože oba řádky v souboru C říkají něco jiného.
- `constantValue` je v pořádku, protože je ve flash a nikdo ji nemusí kopírovat.
- `constructedValue` je v pořádku, protože ji konstruktor zapsal *po* (chybějící) inicializaci. Proto se tento druh chyby hledá tak těžko: jedna polovina programu funguje a druhá má náhodné hodnoty.

Se znečištěnou RAM a kompletním startup kódem vypíše stejný program opět správné hodnoty.

## Jak to vypadá v praxi

Několik příznaků a co za nimi obvykle stojí:

| Příznak | Pravděpodobná příčina |
|---|---|
| Program skončí ve HardFault hned po resetu | První slovo vektorové tabulky není platná adresa zásobníku (špatné `_estack`, špatná velikost RAM), nebo tabulka není na začátku flash |
| Globální proměnná s inicializátorem má špatnou hodnotu, ta s `= 0` také | `.data` se nekopíruje nebo `.bss` se nenuluje (špatný symbol, sekce chybějící ve skriptu) |
| Po zapnutí napájení funguje, po resetu selže | Totéž, RAM byla při zapnutí náhodou prázdná |
| Podivná hodnota, která se mění s velikostí kódu | Zásobník roste dolů do `.bss` / `.data`, přetečení zásobníku |
| První `printf` nebo ovladač nefunguje | Kód, který běží před kroky 1 a 2, používá globální proměnnou |

### Co vám říkají čísla z nástroje

```text
   text	   data	    bss	    dec	    hex	filename
    448	      8	      8	    464	    1d0	good.elf
```

- **Flash** = `text` + `data`. Počáteční hodnoty `.data` zabírají místo i ve flash, takže velké inicializované pole vás stojí dvojnásobek: ve flash i v RAM. Pole, které se nemění, by mělo být `const` a pak je jen ve flash.
- **RAM** = `data` + `bss` (+ zásobník a halda).

Zkontrolovat to za vás umí i linker: `-Wl,--print-memory-usage` vypíše, kolik z každé oblasti je využito:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         456 B         1 MB      0.04%
             RAM:          12 B       128 KB      0.01%
```

Zařaďte tento přepínač do buildu a když je něco na neočekávaném místě, přečtěte si soubor `.map` (`-Wl,-Map,out.map`): obsahuje adresu každé funkce a každé proměnné.

## Shrnutí

1. Po resetu jádro přečte dvě slova: ukazatel zásobníku a adresu reset handleru. Vše ostatní je váš kód.
2. **Linker script** je mapa: kde jsou paměti, v jakém pořadí leží sekce a které symboly označují jejich hranice.
3. **Startup kód** je to, co činí slibované vlastnosti jazyka pravdivými: kopíruje `.data`, nuluje `.bss`, spouští konstruktory a volá `main()`.
4. Proměnná, která má hodnotu ve flash a žije v RAM, má dvě adresy, load address a run address. To je klíč k celému tématu.
5. Nechte zapnuté `-Wl,--print-memory-usage` a čtěte `arm-none-eabi-size` a map soubor. Řeknou vám o tom, kam se poděla vaše paměť, víc než debugger.

V Embedbits BSP tyto dva soubory sami nepíšete: linker script se generuje pro vybrané MCU a startup kód přichází s větví BSP pro danou rodinu. Přesto stojí za to pochopit, co dělají, protože když firmware nenastartuje, nikdo jiný vám nepomůže.

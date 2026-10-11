---
title: "Spuštění skutečného firmwaru bez hardwaru: simulátor v CI"
slug: firmware-in-simulator-ci
date: 2026-10-07T18:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

V článku o [unit testování s Unity a CMock](/blog/unit-testing-unity-cmock) jsem řekl, že testy na PC nenajdou „rozdíly mezi PC a MCU". Tento článek je o těchto rozdílech a o nástroji, který je najde: **simulátoru, který spouští skutečný binární soubor**. Ne logiku přeloženou pro PC, ale přímo `.elf`, který vytvořil překladač ARM, se skutečným startup kódem a skutečným linker scriptem, na modelu procesoru a jeho periferií.

Ukážu dva experimenty, které jsem spustil: tentýž zdrojový kód testu, který na PC projde a na Cortex-M4 selže, a firmware, který zapisuje do registrů USART na skutečných adresách STM32F4 a jehož text se objeví v terminálu. Na konci je upřímný seznam toho, co vám simulátor neřekne.

<!-- truncate -->

## Kam to zapadá

| Úroveň | Co běží | Co najde | Rychlost |
|---|---|---|---|
| **Unit test na PC** | logika přeložená pro PC, nižší vrstvy mockované | logické chyby | milisekundy |
| **Simulátor** | skutečný binární soubor firmwaru na modelu MCU | chyby specifické pro cíl, startup, ovladače vůči modelu registrů | sekundy |
| **Hardware in the loop** | skutečný firmware na skutečném MCU se skutečnými signály | časování, elektrické chování, skutečné periferie | minuty, laboratoř |

Prostřední úroveň se vynechává nejčastěji a přitom je nejlevnější na přidání do CI, které už firmware sestavuje: simulátor je spustitelný soubor, který zavoláte se souborem, který váš build vytvořil.

Nástrojem v mých experimentech je QEMU 8.2.2 se strojem `netduinoplus2`, modelem desky se **STM32F405** (Cortex-M4 s mapou paměti skutečného čipu: flash na `0x08000000`, RAM na `0x20000000`, periferie na svých skutečných adresách). Platforma má artefakt pro jiný simulátor, **Renode**, a k tomu se vrátím na konci.

## Experiment 1: test, který projde na PC a selže na MCU

Malý modul se dvěma funkcemi, které má každý firmware: převod času a kontrola přijatého bajtu.

```c title="Conversions.c"
#include "Conversions.h"

long Conversions_Get_Microseconds(uint32_t milliseconds)
{
    return (long)milliseconds * 1000L;
}

bool Conversions_Is_HighBitSet(char receivedByte)
{
    return (receivedByte < 0);
}
```

Obě funkce vypadají správně a obě jsou otestovány na PC. Zdrojový kód testu je pro oba cíle stejný: liší se jen výstup. Soubor `Platform.h` tiskne přes `printf` na PC a přes *semihosting* (požadavek na simulátor nebo debugger) na cíli a návratový kód testu říká, zda prošel:

```c title="Platform.h"
#ifndef PLATFORM_H
#define PLATFORM_H

/* The same test source runs on the PC and on the target: only the output differs. */
#if defined(__arm__)
    #include <stdint.h>
    static inline int Semihost_Call(int operation, const void *argument)
    {
        register int   r0 __asm__("r0") = operation;
        register const void *r1 __asm__("r1") = argument;
        __asm__ volatile ("bkpt 0xAB" : "+r"(r0) : "r"(r1) : "memory");
        return r0;
    }
    static inline void Platform_Print(const char *text) { (void)Semihost_Call(0x04, text); }
    static inline void Platform_Exit(int failures)
    {
        /* 0x20026: the application exited normally, 0x20023: the application failed */
        (void)Semihost_Call(0x18, (const void *)(0 == failures ? 0x20026u : 0x20023u));
    }
#else
    #include <stdio.h>
    #include <stdlib.h>
    static inline void Platform_Print(const char *text) { fputs(text, stdout); }
    static inline void Platform_Exit(int failures)      { exit(0 == failures ? 0 : 1); }
#endif

#endif
```

```c title="tests.c"
#include <stdbool.h>
#include <stdint.h>
#include "Conversions.h"
#include "Platform.h"

static int failures;

#define CHECK(condition, name)                                          \
    do {                                                                \
        if (condition) { Platform_Print("PASS  " name "\n"); }          \
        else           { Platform_Print("FAIL  " name "\n"); failures++; } \
    } while (0)

int main(void)
{
    /* 3 000 000 ms = 50 minutes = 3 000 000 000 us */
    CHECK(3000000000L == Conversions_Get_Microseconds(3000000u), "50 minutes in microseconds");
    CHECK(5000L == Conversions_Get_Microseconds(5u),             "5 ms in microseconds");

    /* the byte 0xFF is received from the UART */
    CHECK(true == Conversions_Is_HighBitSet((char)0xFF),         "0xFF has the high bit set");
    CHECK(false == Conversions_Is_HighBitSet((char)0x41),        "'A' has not the high bit set");

    Platform_Exit(failures);
    return failures;
}
```

Na PC:

```text
PASS  50 minutes in microseconds
PASS  5 ms in microseconds
PASS  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 0
```

Tentýž zdroj, přeložený pomocí `arm-none-eabi-gcc` pro Cortex-M4 a spuštěný v QEMU:

```text
FAIL  50 minutes in microseconds
PASS  5 ms in microseconds
FAIL  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 1
```

Dvě chyby a obě jsou na PC neviditelné:

- **`long` má jinou šířku.** Na 64bitovém Linuxu má `long` 64 bitů, na Cortex-M 32. `3 000 000 ms * 1000` je `3 000 000 000`, což se nevejde do znaménkového 32bitového čísla (největší je 2 147 483 647), takže výsledek je špatný a v C je to navíc nedefinované chování.
- **`char` má jiné znaménko.** Standard C nechává otevřené, zda je prosté `char` se znaménkem. Na x86 je, takže `(char)0xFF` je `-1` a kontrola `receivedByte < 0` funguje. Na ARM je *bez znaménka*, takže `(char)0xFF` je `255` a porovnání nikdy neplatí. Překladač ARM to dokonce říká, a jen tam:

```text
Conversions.c:10:26: warning: comparison is always false due to limited range of data type [-Wtype-limits]
```

Obojí je otázka přenositelných typů, což je téma pravidla 4.6 v článku o [MISRA](/blog/misra-c-rules-in-practice): používejte typy s danou velikostí a znaménkem. Opravená verze používá `uint64_t` pro čas a `uint8_t` pro bajt:

```c
uint64_t Conversions_Get_Microseconds_Fixed(uint32_t milliseconds)
{
    return (uint64_t)milliseconds * 1000u;
}

bool Conversions_Is_HighBitSet_Fixed(uint8_t receivedByte)
{
    return (0u != (receivedByte & 0x80u));
}
```

a stejné čtyři kontroly teď procházejí **na obou cílech**, s návratovým kódem 0 na obou. První verze nebyla chybou testu a test na PC nebyl špatně: prostě testoval jiný program.

Návratový kód je celá integrace s CI. Simulátor skončí s kódem, který firmware předá volání semihostingu, takže `add_test` v CMake (viz článek o [CMake pro firmware](/blog/cmake-for-embedded-firmware)) selže, když selže test na cíli:

```cmake
add_test(NAME conversions_on_target
    COMMAND qemu-system-arm -M netduinoplus2 -nographic
            -semihosting-config enable=on,target=native -kernel conversions_test.elf)
```

## Experiment 2: registry periferie

Simulátor modeluje také periferie, takže může běžet i kód nejbližší hardwaru. Tohle je firmware, který posílá text přes USART1 čipu STM32F4, napsaný na úrovni registrů se skutečnými adresami (žádná knihovna, žádný startup kromě kódu z článku o tom, [co se děje před `main()`](/blog/before-main-startup-linker)):

```c title="uart.c"
#include <stdint.h>

/* STM32F4: RCC and USART1 registers, the same addresses as on the real chip */
#define RCC_APB2ENR  (*(volatile uint32_t *)0x40023844u)
#define USART1_SR    (*(volatile uint32_t *)0x40011000u)
#define USART1_DR    (*(volatile uint32_t *)0x40011004u)
#define USART1_CR1   (*(volatile uint32_t *)0x4001100Cu)

#define RCC_APB2ENR_USART1EN  ( 1u << 4 )
#define USART_CR1_UE          ( 1u << 13 )
#define USART_CR1_TE          ( 1u << 3 )
#define USART_SR_TXE          ( 1u << 7 )

static void Uart_Send(const char *text)
{
    while ('\0' != *text)
    {
        while (0u == (USART1_SR & USART_SR_TXE)) { }     /* wait until the data register is empty */
        USART1_DR = (uint32_t)(unsigned char)*text++;
    }
}

int main(void)
{
    RCC_APB2ENR |= RCC_APB2ENR_USART1EN;                  /* clock of the peripheral */
    USART1_CR1  |= USART_CR1_UE | USART_CR1_TE;           /* enable the USART and its transmitter */

    Uart_Send("hello from the register level\r\n");

    for (;;) { }
}
```

```text
hello from the register level
```

Text je v terminálu simulátoru: firmware zapnul hodiny periferie v RCC, povolil USART a jeho vysílač, počkal na příznak `TXE` a zapsal datový registr, přesně jako by to udělal na desce, a model USART předal bajt na sériový port. Je to test ovladače proti modelu registrového rozhraní. Pokud ovladač čeká na příznak, který nikdy nepřijde, test to najde pomocí timeoutu, a ne u stolu s osciloskopem.

## Co vám simulátor neřekne

Simulátor je *model* a každý model má hranici. Několik, na které jsem narazil v experimentech této série:

- **Časování není skutečné.** QEMU provádí instrukce tak rychle, jak PC dovolí, a nepočítá cykly skutečného jádra. Test, který musí dokázat „přerušení je obslouženo do 5 mikrosekund", se v něm udělat nedá.
- **Přerušení přicházejí na jiných místech než na MCU.** V článku o [přerušeních](/blog/interrupts-and-main-shared-data) se ztracená aktualizace sdíleného čítače v QEMU neobjevila ani při 200 000 pokusech, protože QEMU doručuje přerušení mezi bloky přeloženého kódu. Skutečné MCU může přerušit po každé instrukci. Simulátor neprokazuje nepřítomnost race condition.
- **Existují jen modelované periferie.** Model STM32F405 má USART, ale jiný čip může mít periferii, kterou model nemá, nebo ji má zjednodušenou: registry tam jsou, analogová část ne.
- **Chybí elektrický svět:** zákmit kontaktu, šum na vstupu ADC, pokles napětí. Vše, co přichází zvenčí, je to, co do modelu vložíte.

Simulátor tedy nenahrazuje ani unit testy (jsou rychlejší a testují logiku izolovaně), ani hardwarové testy (testují realitu). Najde věci mezi nimi: překladač cíle, typy, startup, mapu paměti, ovladač proti modelu registrů, a dělá to během několika sekund při každém commitu.

## Renode

Platforma má artefakt pro **Renode**, open-source simulační a virtuální vývojový framework od Antmicro, dodávaný spolu s `renode-test`, svým testovacím runnerem založeným na Robot Framework, který se používá pro integrační testy simulovaného firmwaru. Pro tento článek jsem ho nespouštěl (vydání se v mém prostředí nepodařilo stáhnout), takže pouze opakuji, co říká jeho dokumentace, a neporovnávám ho s QEMU. Struktura takového testu je stejná jako výše: skutečný ELF, model hardwaru, verdikt a návratový kód pro CI.

## Kontrolní seznam

1. Sestavte test pro **cíl**, překladačem cíle, a spusťte ho v simulátoru, navíc k PC.
2. Používejte jeden zdroj testu pro obojí, s tenkou vrstvou (`Platform.h`) pro výstup a ukončení.
3. Návratový kód simulátoru je výsledek testu, takže CI nepotřebuje nic dalšího.
4. Používejte typy s danou velikostí a znaménkem (`uint32_t`, `uint8_t`) a varování překladače cíle: druhou chybu výše (`char`) by našlo `-Wtype-limits`, kdyby se někdo díval na výstup buildu pro ARM.
5. Zapište si, co simulátor dokázat nemůže (časování, race condition, analogový svět), a nechte to hardwarovým testům.

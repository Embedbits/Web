---
title: "Spustenie skutočného firmvéru bez hardvéru: simulátor v CI"
slug: firmware-in-simulator-ci
date: 2026-10-07T18:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

V článku o [unit testovaní s Unity a CMock](/blog/unit-testing-unity-cmock) som napísal, že testy na PC nenájdu „rozdiely medzi PC a MCU". Tento článok je o týchto rozdieloch a o nástroji, ktorý ich nájde: o **simulátore, ktorý spúšťa skutočný binárny súbor**. Nie logiku skompilovanú pre PC, ale ten istý `.elf`, ktorý vyrobil kompilátor ARM, so skutočným startup kódom a skutočným linker scriptom, na modeli procesora a jeho periférií.

Ukážem dva experimenty, ktoré som spustil: ten istý zdrojový kód testu, ktorý prejde na PC a zlyhá na Cortex-M4, a firmvér, ktorý zapisuje do registrov USART na skutočných adresách STM32F4 a ktorého text sa objaví v termináli. Na konci je úprimný zoznam toho, čo vám simulátor nepovie.

<!-- truncate -->

## Kde to zapadá

| Úroveň | Čo beží | Čo nájde | Rýchlosť |
|---|---|---|---|
| **Unit test na PC** | logika skompilovaná pre PC, vrstvy pod ňou namockované | chyby v logike | milisekundy |
| **Simulátor** | skutočný binárny súbor firmvéru na modeli MCU | chyby špecifické pre cieľové zariadenie, startup, ovládače voči modelu registrov | sekundy |
| **Hardware in the loop** | skutočný firmvér na skutočnom MCU so skutočnými signálmi | časovanie, elektrické správanie, skutočné periférie | minúty, laboratórium |

Stredná úroveň je tá, ktorá sa vynecháva najčastejšie, a pritom je najlacnejšia na pridanie do CI, ktoré už firmvér zostavuje: simulátor je spustiteľný súbor, ktorému odovzdáte súbor, ktorý vyprodukoval váš build.

Nástrojom v mojich experimentoch je QEMU 8.2.2 so strojom `netduinoplus2`, modelom dosky s **STM32F405** (Cortex-M4 s pamäťovou mapou skutočného čipu: flash na `0x08000000`, RAM na `0x20000000`, periférie na ich skutočných adresách). Platforma má artefakt pre iný simulátor, **Renode**, a vrátim sa k nemu na konci.

## Experiment 1: test, ktorý prejde na PC a zlyhá na MCU

Malý modul s dvoma funkciami, ktoré má každý firmvér: prevod času a kontrola prijatého bajtu.

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

Obe funkcie vyzerajú správne a obe sú otestované na PC. Zdrojový kód testu je pre oba ciele rovnaký: líši sa len výstup. Súbor `Platform.h` tlačí cez `printf` na PC a cez *semihosting* (požiadavku na simulátor alebo debugger) na cieľovom zariadení a návratový kód testu hovorí, či prešiel:

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

Ten istý zdrojový kód, skompilovaný pomocou `arm-none-eabi-gcc` pre Cortex-M4 a spustený v QEMU:

```text
FAIL  50 minutes in microseconds
PASS  5 ms in microseconds
FAIL  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 1
```

Dve chyby, obe na PC neviditeľné:

- **`long` má inú šírku.** Na 64-bitovom Linuxe na PC má `long` 64 bitov, na Cortex-M má 32. `3 000 000 ms * 1000` je `3 000 000 000`, čo sa nezmestí do 32-bitového čísla so znamienkom (najväčšie je 2 147 483 647), takže výsledok je nesprávny a v C ide navyše o nedefinované správanie.
- **`char` má iné znamienko.** Norma C nechráva otvorené, či je obyčajný `char` so znamienkom. Na x86 je, takže `(char)0xFF` je `-1` a kontrola `receivedByte < 0` funguje. Na ARM je *bez znamienka*, takže `(char)0xFF` je `255` a porovnanie nikdy nie je pravdivé. Kompilátor ARM to dokonca povie, a len tam:

```text
Conversions.c:10:26: warning: comparison is always false due to limited range of data type [-Wtype-limits]
```

Obe sú otázkou prenosných typov, čo je téma pravidla 4.6 v článku o [MISRA](/blog/misra-c-rules-in-practice): používajte typy s veľkosťou a znamienkom. Opravená verzia používa `uint64_t` pre čas a `uint8_t` pre bajt:

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

a tie isté štyri kontroly teraz prejdú **na oboch cieľoch**, s návratovým kódom 0 na oboch. Prvá verzia nebola chybou testu a test na PC nebol nesprávny: jednoducho testoval iný program.

Návratový kód je celá integrácia s CI. Simulátor skončí s kódom, ktorý firmvér odovzdá volaniu semihostingu, takže `add_test` v CMake (pozrite článok o [CMake pre firmvér](/blog/cmake-for-embedded-firmware)) zlyhá, keď zlyhá test na cieľovom zariadení:

```cmake
add_test(NAME conversions_on_target
    COMMAND qemu-system-arm -M netduinoplus2 -nographic
            -semihosting-config enable=on,target=native -kernel conversions_test.elf)
```

## Experiment 2: registre periférie

Simulátor modeluje aj periférie, a tak môže bežať aj kód najbližší k hardvéru. Toto je firmvér, ktorý posiela text cez USART1 na STM32F4, napísaný na úrovni registrov so skutočnými adresami (žiadna knižnica, žiadny startup nad rámec kódu z článku o tom, [čo sa stane pred `main()`](/blog/before-main-startup-linker)):

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

Text je v termináli simulátora: firmvér zapol hodiny periférie v RCC, povolil USART a jeho vysielač, počkal na príznak `TXE` a zapísal do dátového registra, presne tak, ako by to urobil na doske, a model USART odovzdal bajt sériovému portu. Je to test ovládača voči modelu registrového rozhrania. Ak ovládač čaká na príznak, ktorý nikdy nepríde, test to nájde pomocou timeoutu, a nie pri stole s osciloskopom.

## Čo vám simulátor nepovie

Simulátor je *model* a každý model má hranicu. Niekoľko, na ktoré som narazil v experimentoch tejto série:

- **Časovanie nie je skutočné.** QEMU vykonáva inštrukcie tak rýchlo, ako dovolí PC, a nepočíta cykly skutočného jadra. Test, ktorý má dokázať „prerušenie sa obslúži do 5 mikrosekúnd", sa v ňom urobiť nedá.
- **Prerušenia prichádzajú na iných miestach než na MCU.** V článku o [prerušeniach](/blog/interrupts-and-main-shared-data) sa stratená aktualizácia zdieľaného počítadla v QEMU neobjavila ani v 200 000 pokusoch, pretože QEMU doručuje prerušenie medzi blokmi preloženého kódu. Skutočné MCU môže prerušiť po každej inštrukcii. Simulátor nedokazuje neprítomnosť race condition.
- **Existujú len namodelované periférie.** Model STM32F405 má USART, ale iný čip môže mať perifériu, ktorú model nemá, alebo ju má v zjednodušenej podobe: registre tam sú, analógová časť nie.
- **Chýba elektrický svet:** zákmity kontaktu, šum na vstupe ADC, pokles napätia. Všetko, čo prichádza zvonku, je to, čo do modelu vložíte.

Simulátor teda nenahrádza ani unit testy (sú rýchlejšie a testujú logiku izolovane), ani hardvérové testy (testujú realitu). Nájde veci medzi nimi: kompilátor cieľového zariadenia, typy, startup, pamäťovú mapu, ovládač voči modelu registrov, a robí to za pár sekúnd pri každom commite.

## Renode

Platforma má artefakt pre **Renode**, open-source simulačný a virtuálny vývojový framework od Antmicro, dodávaný spolu s `renode-test`, jeho testovacím runnerom založeným na Robot Framework, ktorý sa používa na integračné testy simulovaného firmvéru. Pre tento článok som ho nespúšťal (vydanie sa v mojom prostredí nedalo stiahnuť), takže iba opakujem, čo hovorí jeho dokumentácia, a neporovnávam ho s QEMU. Štruktúra takéhoto testu je rovnaká ako vyššie: skutočný ELF, model hardvéru, verdikt a návratový kód pre CI.

## Kontrolný zoznam

1. Zostavte test pre **cieľové zariadenie**, kompilátorom cieľového zariadenia, a spustite ho v simulátore, popri PC.
2. Použite jeden zdrojový kód testu pre oba, s tenkou vrstvou (`Platform.h`) pre výstup a ukončenie.
3. Návratový kód simulátora je výsledok testu, takže CI nepotrebuje nič viac.
4. Používajte typy s veľkosťou a znamienkom (`uint32_t`, `uint8_t`) a varovania kompilátora cieľového zariadenia: druhú chybu vyššie (`char`) by našlo `-Wtype-limits`, keby sa niekto pozrel na výstup buildu pre ARM.
5. Zapíšte si, čo simulátor nevie dokázať (časovanie, race condition, analógový svet), a nechajte to na hardvérové testy.

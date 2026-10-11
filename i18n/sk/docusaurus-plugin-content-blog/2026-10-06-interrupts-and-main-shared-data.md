---
title: "Prerušenia a main(): ako bezpečne zdieľať dáta"
slug: interrupts-and-main-shared-data
date: 2026-10-06T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Obsluha prerušenia a hlavná slučka sú dva programy, ktoré bežia v tej istej pamäti a o sebe nevedia. Kompilátor C nevie, že prerušenie existuje, a CPU nevie, že dve premenné patria k sebe. Vie to jedine programátor a chyby, ktoré z toho vznikajú, sú najhoršieho druhu: objavia sa raz za tisíc behov, zmiznú, keď pripojíte debugger, a nikdy sa neobjavia pri code review, pretože kód vyzerá správne.

Tento článok prejde tri problémy zdieľaných dát jeden po druhom s kódom, ktorý **zlyháva**, a potom ukáže vzory, ktoré fungujú. Experimenty bežia na Cortex-M4 (v QEMU, na modeli dosky STM32F4) alebo na PC a výstupy sú skutočné.

<!-- truncate -->

## Problém 1: kompilátor nevidí prerušenie

Najjednoduchšia komunikácia medzi prerušením a hlavnou slučkou je flag. Prerušenie ho nastaví, hlavná slučka naň čaká:

```c title="main.c (a part)"
#ifdef USE_VOLATILE
static volatile bool dataReady;
#else
static bool dataReady;
#endif

void SysTick_Handler(void)
{
    dataReady = true;
}

int main(void)
{
    SysTick_Start(1000u);

    while (!dataReady)
    {
        /* waiting for the interrupt */
    }

    Print("the interrupt was seen\n");
    Quit();
    return 0;
}
```

Toto je celý program a s optimalizáciou `-O2` sa **nikdy neskončí**. Spustil som ho v QEMU so SysTick ako zdrojom prerušenia (prerušenie sa spustí a nastaví flag) a porovnal verziu s `volatile` a bez neho:

```text
--- without volatile
(no output, the program was killed by the timeout after 5 s)
--- with volatile
the interrupt was seen
```

Prečo? Pozrite sa, čo kompilátor vygeneroval pre slučku v prvej verzii:

```text
 8000062:  ldrb  r3, [r1, #0]       @ read the flag once
 8000064:  cbnz  r3, 8000068        @ non-zero: leave the loop
 8000066:  b.n   8000066            @ zero: jump to itself, forever
```

Kompilátor uvažuje iba o kóde `main()` a v tom kóde do `dataReady` nikto nezapisuje. Hodnota sa teda nemôže zmeniť, stačí ju prečítať raz a slučka sa zmení na nekonečnú. Presne to, o čo ste z jeho pohľadu požiadali. S `volatile` musí kompilátor premennú čítať z pamäte pri každom prechode:

```text
 8000062:  ldrb  r3, [r2, #0]       @ read the flag in every pass
 8000064:  cmp   r3, #0
 8000066:  beq.n 8000062
```

Poučenie: **každá premenná zdieľaná medzi prerušením a hlavným kódom musí byť `volatile`.** To isté platí pre každý register periférie, a preto sú definície registrov v hlavičkách CMSIS `volatile`. Pamätajte, že v debug builde (`-O0`) to bez neho funguje a v release builde zlyhá, a preto sa chyba nájde neskoro.

## Problém 2: `volatile` neznamená atomické

`volatile` hovorí „čítaj a zapisuj pamäť zakaždým“. Nehovorí „naraz“. Nevinný riadok `counter++` sú tri inštrukcie:

```text
Increment_Plain:
   ldr   r2, [pc, #8]       @ address of the counter
   ldr   r3, [r2, #0]       @ 1. load the value
   adds  r3, #1             @ 2. add one
   str   r3, [r2, #0]       @ 3. store it back
```

Ak prerušenie príde medzi načítaním a uložením a prerušenie tiež inkrementuje čítač, jedna z dvoch inkrementácií sa **stratí**: hlavný kód uloží starú hodnotu plus jedna cez hodnotu, ktorú práve uložilo prerušenie. Časová os:

| Krok | Hlavný kód | Prerušenie | Čítač |
|---|---|---|---|
| 1 | načíta 5 | | 5 |
| 2 | | načíta 5, pripočíta 1, uloží 6 | 6 |
| 3 | pripočíta 1 (v registri má 5) | | 6 |
| 4 | uloží 6 | | **6, malo byť 7** |

Chcel som to ukázať aj na Cortex-M4 a nevyšlo to: pri 200 000 inkrementáciách s prerušením každých pár inštrukcií QEMU nestratilo nič. Pravdepodobne preto, že QEMU kontroluje prerušenia medzi blokmi preloženého kódu, takže žiadne nepristane medzi `ldr` a `str`. Je to užitočná pripomienka, že **simulátor nedokazuje neprítomnosť race condition**: skutočné MCU môže prerušiť po každej inštrukcii. Ten istý race na mieste, kde sa dá ľahko reprodukovať, sú dve vlákna na PC:

```c title="host_race.c"
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>

#define INCREMENTS  ( 2000000u )

static volatile uint32_t plainCounter;
static _Atomic uint32_t  atomicCounter;

static void *Worker(void *argument)
{
    (void)argument;
    for (uint32_t index = 0u; index < INCREMENTS; index++)
    {
        plainCounter++;                       /* load, add, store: not atomic */
        atomic_fetch_add(&atomicCounter, 1u); /* one indivisible operation    */
    }
    return NULL;
}

int main(void)
{
    pthread_t first, second;

    pthread_create(&first, NULL, Worker, NULL);
    pthread_create(&second, NULL, Worker, NULL);
    pthread_join(first, NULL);
    pthread_join(second, NULL);

    printf("expected        %u\n", 2u * INCREMENTS);
    printf("plain counter   %u (lost %u)\n", plainCounter, 2u * INCREMENTS - plainCounter);
    printf("atomic counter  %u (lost %u)\n", atomicCounter, 2u * INCREMENTS - atomicCounter);
    return 0;
}
```

```text
expected        4000000
plain counter   2652421 (lost 1347579)
atomic counter  4000000 (lost 0)
```

Tretina všetkých inkrementácií sa stratí a výsledky sa líšia beh od behu. Vlákno na PC a prerušenie na MCU sú v tomto ohľade to isté: druhý tok riadenia, ktorý môže udrieť medzi dve inštrukcie. To isté platí pre všetko, čo je väčšie ako slovo CPU: 64-bitová časová pečiatka alebo štruktúra s dvoma poľami sa môže prečítať napoly stará a napoly nová (*torn read*).

## Tri spôsoby riešenia

### 1. Jeden zapisovateľ pre každú premennú (najlepší)

Najrobustnejšie riešenie je navrhnúť dáta tak, aby **každú premennú zapisovala len jedna strana**. Prerušenie zapíše flag, hlavný kód ho iba číta a nemaže (alebo naopak). Bez dvoch zapisovateľov niet čo stratiť. Ak obe strany potrebujú meniť to isté, nemali by to zdieľať: každá má vlastnú premennú (čítač prerušení je `isrCalls`, čítač hlavného kódu je iný) a súčet urobí čitateľ.

### 2. Kritická sekcia

Keď sa dvom zapisovateľom nedá vyhnúť, prerušenia sa na čas operácie zakážu. Správny spôsob je **uložiť stav a obnoviť ho**, a nie na konci slepo povoliť prerušenia, pretože funkcia mohla byť zavolaná s už zakázanými prerušeniami:

```text
Increment_CriticalSection:
   mrs   r1, PRIMASK        @ save the state of the mask
   cpsid i                  @ disable the interrupts
   ldr   r3, [r2, #0]
   adds  r3, #1
   str   r3, [r2, #0]
   msr   PRIMASK, r1        @ restore the state, as it was
```

Cenou je latencia: počas sekcie nemôže bežať žiadne prerušenie. Sekcia teda musí byť krátka, na pár inštrukcií, a bez volania funkcie, cyklu alebo čakania vo vnútri.

### 3. Atomická operácia

Pre jedno slovo (čítač, flag s počtom) má procesor inštrukcie `LDREX` a `STREX`: uloženie uspeje len vtedy, ak sa adresy od načítania nikto nedotkol, a ak sa dotkol, cyklus sa zopakuje. Kompilátor ich za vás vygeneruje zo štandardnej operácie:

```text
Increment_Atomic:
   ldrex r1, [r3]           @ load and mark the address
   adds  r1, #1
   strex r2, r1, [r3]       @ store only if nobody has touched it, r2 = 0 on success
   cmp   r2, #0
   bne.n Increment_Atomic   @ somebody did: try again
```

v C je to jeden riadok, `__atomic_fetch_add(&counter, 1u, __ATOMIC_RELAXED)` (alebo `atomic_fetch_add()` z `<stdatomic.h>`). Neblokuje prerušenia, takže nepridáva latenciu. Funguje pre jednu premennú; pre dve premenné, ktoré patria k sebe, nepomôže.

## Najpoužívanejší vzor: kruhový buffer

Najčastejšia vec, ktorú prerušenie odovzdáva hlavnému kódu, je tok dát: bajty prijaté cez UART, vzorky z ADC. Prerušenie ich nemôže spracovať (musí byť krátke), a tak ich vloží do **fronty** a hlavný kód ich vyberie v pokojnej chvíli. Je to problém producent-konzument s *jedným producentom* (prerušenie) a *jedným konzumentom* (hlavný kód) a pre tento konkrétny prípad kruhový buffer **nepotrebuje žiadny zámok**:

```c title="Ring.h"
#ifndef RING_H
#define RING_H

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>

#define RING_SIZE  ( 16u )                       /* has to be a power of two */
#define RING_MASK  ( RING_SIZE - 1u )

/*
 * Single producer, single consumer ring buffer without any lock.
 * head: written only by the producer, tail: written only by the consumer.
 * Both are free-running counters, the difference is the number of items.
 */
typedef struct
{
    uint32_t         items[RING_SIZE];
    atomic_uint_fast32_t head;
    atomic_uint_fast32_t tail;
}   ring_t;

static inline bool Ring_Push(ring_t *ring, uint32_t item)
{
    const uint_fast32_t head = atomic_load_explicit(&ring->head, memory_order_relaxed);
    const uint_fast32_t tail = atomic_load_explicit(&ring->tail, memory_order_acquire);

    if (RING_SIZE == (head - tail))
    {
        return false;                            /* full, the producer decides what to do */
    }

    ring->items[head & RING_MASK] = item;
    atomic_store_explicit(&ring->head, head + 1u, memory_order_release);   /* publish the item */
    return true;
}

static inline bool Ring_Pop(ring_t *ring, uint32_t *item)
{
    const uint_fast32_t tail = atomic_load_explicit(&ring->tail, memory_order_relaxed);
    const uint_fast32_t head = atomic_load_explicit(&ring->head, memory_order_acquire);

    if (head == tail)
    {
        return false;                            /* empty */
    }

    *item = ring->items[tail & RING_MASK];
    atomic_store_explicit(&ring->tail, tail + 1u, memory_order_release);   /* free the slot */
    return true;
}

#endif
```

Prečo je to správne?

- `head` zapisuje **iba producent** a `tail` **iba konzument**. Nie je tu premenná s dvoma zapisovateľmi, takže sa nemôže stratiť žiadna aktualizácia: je to prvé riešenie vyššie, zabudované do štruktúry.
- Čítače sú voľne bežiace (nikdy sa neresetujú). Počet položiek je `head - tail` a vďaka aritmetike bez znamienka je správny aj po pretečení čítačov. Pri veľkosti, ktorá je mocninou dvojky, je pozícia jednoduchá maska namiesto delenia.
- Záleží na **poradí**: producent zapíše položku a **potom** ju zverejní posunutím `head` (`memory_order_release`) a konzument číta najprv `head` (`memory_order_acquire`) a až potom položku. Na jedinom jadre Cortex-M je jediné, na čom záleží, poradie, v akom kompilátor zapisuje, a atomiky ho zachovávajú. Na MCU s dvoma jadrami (niektoré STM32H7 majú dve) alebo s cache je ten istý kód stále správny, čo je dôvod písať ho v tejto forme a nie s `volatile`, ktoré náhodou funguje.
- Producent nečaká. Plný buffer znamená „zahoď položku a spočítaj ju“, pretože prerušenie nemôže na nikoho čakať. Počítadlo zahodených vám v teste povie, že buffer je primalý.

Otestoval som to dvoma spôsobmi. Na PC s dvoma vláknami, producentom a konzumentom, prejde bufferom s 16 slotmi 20 miliónov položiek:

```text
items 20000000, order errors 0
```

a na Cortex-M4 v QEMU: prerušenie SysTick je producent a `main()` konzument, s 5000 položkami:

```text
items received  5000
order errors    0
full buffer hits 0
```

Prvý test je ťažší (dve vlákna naozaj bežia paralelne na dvoch jadrách), druhý je skutočná situácia MCU. Je to tiež perfektný kandidát na unit test na PC, ako v článku o [unit testovaní s Unity a CMock](/blog/unit-testing-unity-cmock): modul je nezávislý od hardvéru.

## Pravidlá pre obsluhy prerušení

1. **Krátke.** Prečítajte register, uložte dáta, nastavte flag, zrušte pending flag, vráťte sa. Spracovanie sa robí v hlavnom kóde.
2. **Žiadne čakanie, žiadna alokácia, žiadny `printf`.** Nič, čo blokuje, trvá dlho alebo volá funkciu, ktorú nie je bezpečné volať z prerušenia (je *non-reentrant*, ak vo vnútri používa statický buffer).
3. **Všetko zdieľané je `volatile` alebo atomické** a každá premenná má definovaného zapisovateľa.
4. **Nezdieľajte viac, než musíte.** Flag alebo fronta medzi stranami, nie štruktúra s desiatimi poliami.
5. **Myslite na prioritu.** Prerušenie vyššej priority môže prerušiť iné prerušenie. Premenná zdieľaná medzi dvoma prerušeniami má rovnaký problém ako zdieľaná s hlavným kódom.

V Embedbits BSP majú periférne moduly (napr. USART) variant spracovania dát s pollingom, s prerušením a s DMA a variant s prerušením je presne toto: obsluha na úrovni MCAL, ktorá berie dáta z periférie a odovzdáva ich aplikácii cez buffer, kým `Task` modulu beží v hlavnej slučke a robí spracovanie.

## Zhrnutie

| Problém | Príznak | Liek |
|---|---|---|
| Kompilátor nevidí prerušenie | Funguje s `-O0`, nekonečná slučka s `-O2` | `volatile` na každej zdieľanej premennej |
| `counter++` nie je atomické | Počet, ktorý je občas primalý | Jeden zapisovateľ na premennú, kritická sekcia alebo `atomic_fetch_add` |
| Viac než slovo | Napoly stará, napoly nová hodnota | Kritická sekcia, alebo poradové číslo, alebo fronta |
| Tok dát | Stratené alebo pomiešané bajty | Kruhový buffer s jedným producentom a jedným konzumentom |
| Test prejde v simulátore | Chyba v teréne | Pamätajte, že simulátor prerušuje na iných miestach než MCU |

Tri druhy kódu v tomto článku mali jedno spoločné: všetky *vyzerali* správne.

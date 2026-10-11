---
title: "Návrh a architektúra"
slug: design-architecture
date: 2024-09-29T20:59:52
authors: [Mr.Nobody]
tags: [embedded, architecture]
image: /img/blog/architecture-layers.png
---

OCD. Tri skvelé písmená, ktoré ma nútia stále myslieť na architektúru softvéru. Môže to byť naozaj bolestivé, najmä ak sa musím vyrovnať s architektúrou v štýle „Arduino". Určite ju poznáte: celý projekt v pár priečinkoch, aplikácia v priečinku *src*, nízkoúrovňová funkcionalita v priečinku *driver* a tak ďalej. Ale čo robiť v komplexných systémoch?

<!-- truncate -->

## Modularita

Každá skupina funkcionality má byť zapuzdrená v balíku. Spájaním takýchto balíkov dostávame stále zložitejšie systémy. Predstavte si projekt, v ktorom chcete merať teplotu senzorom pripojeným na ADC a aktuálne dáta posielať cez UART. Potrebujeme modul, ktorý číta surové dáta z ADC, vypočíta hodnotu v °C a poskytne ju na svojom rozhraní, a ďalší modul, ktorý obsluhuje komunikáciu cez UART.

Ak by sme všetku túto funkcionalitu skombinovali na jednom mieste, určovali by sme polohu a rýchlosť elementárnej častice súčasne. To by spôsobilo kolaps vlnovej funkcie a zničenie vesmíru (sarkazmus).

## Abstrakčné vrstvy

Predstavte si strom. Vrchol stromu je jediný bod, ktorý obsluhuje alebo vykonáva potrebnú funkcionalitu. V embedded systémoch to môže byť nekonečná slučka vo funkcii main alebo nejaký handler RTOS. Čím nižšie strom ide, tým je širší. To predstavuje spojenia a hierarchiu medzi modulmi. Korene stromu predstavujú spojenia s hardvérom.

Základným príkladom je „blinky": LED pripojená na PA1 sa má rozsvietiť, ak je stlačené tlačidlo pripojené na PA0, a naopak.

```c
#include "stm32g4xx_ll_gpio.h"

void main(void)
{
  while(1)
  {
    if(0u != LL_GPIO_IsInputPinSet(GPIOA, LL_GPIO_PIN_0))
    {
      LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_1);
    }
    else
    {
      LL_GPIO_ResetOutputPin(GPIOA, LL_GPIO_PIN_1);
    }
  }
}
```

V tomto príklade sme zmiešali všetky vrstvy. Pre primitívny projekt to môže byť prijateľné, ale v komplexnom systéme to vedie k anarchii, neporiadku, špagetovému kódu **a koncu sveta**. Aby sme sa vyhli mizernému, dlhému a rozhodujúcemu armagedonu, ľudia vynašli pár úžasných vecí, ako hierarchia a abstrakčné vrstvy. Vo svojich projektoch rozdeľujem funkcionalitu do troch základných vrstiev: Application, Middleware a Board Support Package (aka BSP). Tie sa ďalej členia na viacero vrstiev, aby sa dosiahla prenositeľnosť a modularita.

![Štruktúra priečinkov projektu: Application, Artifacts, Bsp (Hal, LinkerFiles, Mcal, Ral, Startup), Docs a Middlewares](/img/blog/architecture-layers.png)

*Application* obsahuje to, čo produkt robí. *Middleware* obsahuje opakovane použiteľný softvér bez závislosti od hardvéru, ako logger, zásobník ModBus alebo správca nevolatilnej pamäte. A čo je BSP? Jednoduché. Obsahuje všetko potrebné pre komunikáciu, konfiguráciu a obsluhu hardvéru. Z nášho príkladu vyššie patria operácie s GPIO do BSP. Používateľa nemá zaujímať presné zapojenie tlačidla a LED, takže rozhranie medzi BSP a aplikáciou môže vyzerať ako ***Bsp_Get_ButtonState()*** a ***Bsp_Set_LedState()***. Ak sa v hardvéri niečo zmení, nikto nemusí upravovať viacero miest a aktualizuje sa iba BSP.

BSP teda obsahuje aspoň jednu vrstvu zapuzdrenia pre tieto gettery a settery. Ale čo budú používať? Budú zapisovať priamo do registrov? Nemyslím si. STMicroelectronics má dve sady „ovládačov": „HAL" a „LL". Prečo úvodzovky? Pretože ani jeden názov nie je správny. Ich balík „HAL" je v skutočnosti obrovský a pomalý špagetový kód, ktorý nemá nič spoločné so svojím popisom, pretože HAL znamená Hardware Abstraction Layer. K tomu pravému sa dostaneme na konci.

## Register Abstraction Layer (RAL)

Funkcie `LL_GPIO_xxx` z príkladu sú zapuzdrený prístup k registrom MCU. Operácie s registrami môžete písať všade, ale čo ak zmeníte MCU alebo urobíte chybu? Musíte to opraviť na každom jednom mieste. To by bolo bolestivé, takže sme práve našli najnižšiu abstrakčnú vrstvu, *Register Abstraction Layer*. Predstavuje iba abstrakciu registrov, zapuzdrenú vo (zvyčajne inline) funkciách so zmysluplnými názvami.

```c
__STATIC_INLINE void LL_GPIO_SetOutputPin(GPIO_TypeDef *GPIOx, uint32_t PinMask)
{
  WRITE_REG(GPIOx->BSRR, PinMask);
}
```

Názov „LL" je z môjho pohľadu nesprávny (rovnako ako ich HAL, ale kto by ho používal?), ale dostávame prístup ku všetkým registrom so zmysluplným popisom, takže ho môžeme používať bez namáhavého ručného písania.

V mojich projektoch sa RAL skladá z troch častí:

- **CMSIS** od ARM: definície jadra Cortex-M,
- **CMSIS_ST** od STMicroelectronics: headery zariadení s definíciami registrov a systémovou inicializáciou rodiny MCU,
- **RAL_ST**: pôvodné ovládače LL od ST spolu s mojou vrstvou `Port`. Vrstva `Port` poskytuje jednotné pomenovanie nezávislé od rodiny MCU, takže kód nad RAL sa nemení, keď sa mení MCU.

RAL pozná registre a nič iné. Nevie, že na PA1 je niečo pripojené.

## Microcontroller Abstraction Layer (MCAL)

Máme teda jednoduchý prístup k registrom. Ale čo bude ďalej? Prístup ku GPIO je triviálny, ale čo ostatné periférie? Na prenos cez UART potrebujeme pri každej operácii viacero registrov: aktivovať perifériu, nastaviť baudrate, dĺžku bitov, paritu, stop bity a tak ďalej. A keďže už vieme, že každá funkcionalita, ktorá sa používa viac než raz, má byť zapuzdrená, vytvoríme funkcie na čítanie chýb, spustenie prenosu, zápis do výstupného dátového registra, čítanie zo vstupného dátového registra a mnohé ďalšie.

Táto funkcionalita nemôže byť RAL, pretože je hierarchicky vyššie a volá RAL. Stará sa iba o periférie mikrokontroléra, preto sa táto vrstva volá *Microcontroller Abstraction Layer* (MCAL). Používateľ vidí `Gpio_Set_PinLevel()` alebo `Usart_Send()` a nepotrebuje poznať ani jeden register. Jedna periféria, jedno rozhranie: ak I2C potrebuje DMA, modul I2C si ho obslúži interne.

## Hardware Abstraction Layer (HAL)

Teraz môžeme inicializovať všetky periférie MCU: RCC, DMA, USART/UART a tak ďalej. Ale konfigurácia musí byť kompatibilná so zariadeniami pripojenými na našej DPS. Nezameriavame sa teda iba na MCU, ale na celý obvod. Potrebujeme preto ďalšiu abstrakčnú vrstvu, *Hardware Abstraction Layer* (HAL). Áno, toto je skutočný význam tohto názvu, nie ako „HAL" od ST.

HAL je jediný bod rozhrania medzi aplikáciou (alebo middlewarom) a hardvérom. Vie, ktorý pin je LED, ktorý UART je pripojený na ladiaci konektor a ako sú periférie nakonfigurované. Na dosiahnutie potrebnej funkcionality prepája viacero modulov z MCAL. Je to posledná abstrakčná vrstva BSP.

## Board Support Package

BSP je hardvérovo orientovaný balík, ktorý obsahuje všetko potrebné na inicializáciu a používanie všetkých periférií MCU a pripojeného obvodu. Okrem troch vrstiev vyššie obsahuje aj **startup** kód (inicializácia pamäťových sekcií a volanie aplikácie) a generovanie **linker** scriptu pre vybraný MCU. Každá rodina STM32 má vlastnú vetvu, takže rozhranie BSP zostáva rovnaké a mení sa iba obsah pod ním.

```text
Application / Middleware
────────────────────────
          HAL            what is connected to which pin, how the board is configured
          MCAL           peripherals: Gpio, Usart, I2c, Dma, ...
          RAL            registers: CMSIS, ST LL drivers, unified Port layer
────────────────────────
         Hardware
```

Pravidlo je jednoduché: **vrstva volá iba vrstvu bezprostredne pod sebou.** Aplikácia nikdy neincluduje header od ST, MCAL nevie, ktorý pin je LED, a RAL nevie, ktorá periféria sa na čo používa.

## Blinky znova

Prepíšme príklad. Aplikácia nepozná žiadny hardvér:

```c
void main(void)
{
  Bsp_Init();

  while(1)
  {
    Bsp_Set_LedState(Bsp_Get_ButtonState());
  }
}
```

BSP pozná dosku a používa MCAL. Piny sú popísané v jedinej tabuľke, takže nová revízia DPS zmení jeden riadok a nič iné (zjednodušene, ošetrenie chýb je vynechané):

```c
typedef struct
{
  gpio_PortId_t portId;
  gpio_PinId_t  pinId;
}   bspPin_t;

static const bspPin_t bspButton = { GPIO_PORT_A, GPIO_PIN_0 };
static const bspPin_t bspLed    = { GPIO_PORT_A, GPIO_PIN_1 };

bool Bsp_Get_ButtonState(void)
{
  gpio_PinLevel_t pinLevel = GPIO_PIN_LEVEL_LOW;

  (void)Gpio_Get_PinLevel(bspButton.portId, bspButton.pinId, &pinLevel);
  return (GPIO_PIN_LEVEL_HIGH == pinLevel);
}

void Bsp_Set_LedState(bool isActive)
{
  (void)Gpio_Set_PinLevel(bspLed.portId, bspLed.pinId,
                          isActive ? GPIO_PIN_LEVEL_HIGH : GPIO_PIN_LEVEL_LOW);
}
```

A kdesi na dne, vo vnútri `Gpio_Set_PinLevel()`, funkcia RAL `LL_GPIO_SetOutputPin()` konečne zapíše register `BSRR`. Štyri vrstvy pre blikajúcu LED vyzerajú ako nezmysel a pre blinky aj sú. Ale podstatné je, čo sa stane, keď produkt rastie:

- **Nová rodina MCU:** stiahne sa iná vetva BSP, aplikácie sa to nedotkne.
- **Nová revízia DPS:** LED sa presunie na iný pin, zmení sa jeden riadok v HAL.
- **Unit test aplikácie:** BSP sa nahradí falošným a aplikácia beží na PC, bez akéhokoľvek hardvéru.
- **Chyba v prístupe k registru:** je presne na jednom mieste.

## Kde to nájdete

Všetky tu popísané vrstvy sú open source a zdokumentované, každá vo vlastnom repozitári organizácie [Embedbits](https://github.com/Embedbits):

- [BSP](/docs/bsp): balík so startupom, linker scriptom a HAL,
- [RAL](/docs/bsp/ral): CMSIS, CMSIS_ST a RAL_ST,
- [MCAL](/docs/bsp/mcal): moduly periférií spolu s tabuľkou podporovaných rodín STM32,
- [coding style](/docs/platform/embi-platform/coding-style), vďaka ktorému sú názvy v týchto vrstvách čitateľné.

Ak chcete vidieť rovnakú myšlienku z pohľadu jazyka, prečítajte si článok o [princípoch SOLID v C++ a C](/blog/solid-principles-c-cpp). Vrstvy vyššie nie sú nič iné než *dependency inversion* aplikovaná na celý firmvér.

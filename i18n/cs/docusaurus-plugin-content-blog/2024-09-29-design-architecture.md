---
title: "Návrh a architektura"
slug: design-architecture
date: 2024-09-29T20:59:52
authors: [Mr.Nobody]
tags: [embedded, architecture]
image: /img/blog/architecture-layers.png
---

OCD. Tři skvělá písmena, která mě nutí neustále přemýšlet o architektuře softwaru. To může být opravdu bolestivé, zvlášť když se musím potýkat s architekturou v „arduinovském" stylu. Určitě ji znáte: celý projekt v pár složkách, aplikace ve složce *src*, nízkoúrovňová funkcionalita ve složce *driver* a tak dále. Ale co dělat ve složitých systémech?

<!-- truncate -->

## Modularita

Každá skupina funkcionality má být zapouzdřena v balíčku. Propojováním takových balíčků dostáváme stále složitější systémy. Představte si projekt, kde chcete měřit teplotu senzorem připojeným k ADC a aktuální data posílat přes UART. Potřebujeme modul, který čte surová data z ADC, vypočítá hodnotu ve °C a poskytne ji na svém rozhraní, a další modul, který obsluhuje komunikaci přes UART.

Kdybychom všechnu tuto funkcionalitu spojili na jednom místě, určovali bychom polohu a rychlost elementární částice současně. To by způsobilo kolaps vlnové funkce a zničení vesmíru (sarkasmus).

## Abstrakční vrstvy

Představte si strom. Vrchol stromu je jediný bod, který řeší nebo vykonává požadovanou funkcionalitu. V embedded systémech to může být nekonečná smyčka ve funkci main nebo nějaký RTOS handler. Čím níže strom jde, tím je širší. To představuje propojení a hierarchii mezi moduly. Kořeny stromu představují spojení s hardwarem.

Základním příkladem je „blinky": LED připojená k PA1 má být aktivní, pokud je stisknuto tlačítko připojené k PA0, a naopak.

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

V tomto příkladu jsme smíchali všechny vrstvy. Pro primitivní projekt to může být přijatelné, ale ve složitém systému to vede k anarchii, nepořádku, špagetovému kódu **a konci světa**. Aby se předešlo ubohému, dlouhému a zásadnímu armagedonu, lidé vymysleli pár skvělých věcí, jako jsou hierarchie a abstrakční vrstvy. Ve svých projektech rozděluji funkcionalitu do tří základních vrstev: Application, Middleware a Board Support Package (alias BSP). Ty se dále dělí na více vrstev, aby se dosáhlo přenositelnosti a modularity.

![Struktura složek projektu: Application, Artifacts, Bsp (Hal, LinkerFiles, Mcal, Ral, Startup), Docs a Middlewares](/img/blog/architecture-layers.png)

*Application* obsahuje to, co produkt dělá. *Middleware* obsahuje znovupoužitelný software bez závislosti na hardwaru, jako je logger, zásobník ModBus nebo správce nevolatilní paměti. A co je to BSP? Jednoduché. Obsahuje vše potřebné pro komunikaci, konfiguraci a obsluhu hardwaru. Z našeho příkladu výše patří operace s GPIO do BSP. Uživatele nemá zajímat přesné zapojení tlačítka a LED, takže rozhraní mezi BSP a aplikací může vypadat jako ***Bsp_Get_ButtonState()*** a ***Bsp_Set_LedState()***. Pokud se v hardwaru cokoli změní, nikdo nemusí upravovat více míst a aktualizuje se jen BSP.

BSP tedy obsahuje alespoň jednu vrstvu zapouzdření pro tyto gettery a settery. Ale co budou používat? Budou zapisovat přímo do registrů? Nemyslím si. STMicroelectronics má dvě sady „ovladačů": „HAL" a „LL". Proč ty uvozovky? Protože ani jeden název není správný. Jejich balíček „HAL" je ve skutečnosti obrovský a pomalý špagetový kód, který nemá nic společného se svým popisem, protože HAL znamená Hardware Abstraction Layer. K té skutečné se dostaneme na konci.

## Register Abstraction Layer (RAL)

Funkce `LL_GPIO_xxx` z příkladu jsou zapouzdřený přístup k registrům MCU. Operace s registry můžete psát kdekoli, ale co když změníte MCU nebo uděláte chybu? Musíte to opravit na každém jednotlivém místě. To by bylo bolestivé, takže jsme právě našli nejnižší abstrakční vrstvu, *Register Abstraction Layer*. Představuje pouze abstrakci registrů, zapouzdřenou ve (obvykle inline) funkcích se smysluplnými názvy.

```c
__STATIC_INLINE void LL_GPIO_SetOutputPin(GPIO_TypeDef *GPIOx, uint32_t PinMask)
{
  WRITE_REG(GPIOx->BSRR, PinMask);
}
```

Název „LL" je z mého pohledu nesprávný (stejně jako jejich HAL, ale kdo by ho používal?), ale získáme přístup ke všem registrům se smysluplným popisem, takže ho můžeme používat bez náročného ručního psaní.

V mých projektech se RAL skládá ze tří částí:

- **CMSIS** od ARM: definice jádra Cortex-M,
- **CMSIS_ST** od STMicroelectronics: hlavičky zařízení s definicemi registrů a systémovou inicializací rodiny MCU,
- **RAL_ST**: původní ovladače LL od ST spolu s mou vrstvou `Port`. Vrstva `Port` poskytuje jednotné pojmenování nezávislé na rodině MCU, takže se kód nad RAL nemění, když se změní MCU.

RAL zná registry a nic jiného. Neví, že něco je připojeno k PA1.

## Microcontroller Abstraction Layer (MCAL)

Máme tedy snadný přístup k registrům. Co ale dál? Přístup k GPIO je triviální, ale co ostatní periferie? Pro přenos přes UART potřebujeme pro každou operaci více registrů: aktivovat periferii, nastavit baudrate, délku bitu, paritu, stop bity a tak dále. A protože už víme, že každá funkcionalita používaná více než jednou má být zapouzdřena, vytvoříme funkce pro čtení chyb, zahájení přenosu, zápis do výstupního datového registru, čtení ze vstupního datového registru a mnoho dalších.

Tato funkcionalita nemůže být RAL, protože je hierarchicky výše a RAL volá. Stará se pouze o periferie mikrokontroléru, takže název této vrstvy je *Microcontroller Abstraction Layer* (MCAL). Uživatel vidí `Gpio_Set_PinLevel()` nebo `Usart_Send()` a nepotřebuje znát jediný registr. Jedna periferie, jedno rozhraní: pokud I2C potřebuje DMA, modul I2C si ho obslouží interně.

## Hardware Abstraction Layer (HAL)

Nyní můžeme inicializovat všechny periferie MCU: RCC, DMA, USART/UART a tak dále. Ale konfigurace musí být kompatibilní se zařízeními připojenými na našem PCB. Nezaměřujeme se tedy jen na MCU, ale na celý obvod. Potřebujeme proto další abstrakční vrstvu, *Hardware Abstraction Layer* (HAL). Ano, toto je skutečný význam tohoto názvu, ne jako u „HAL" od ST.

HAL je jediný bod rozhraní mezi aplikací (nebo middlewarem) a hardwarem. Ví, který pin je LED, který UART je připojen ke konektoru pro ladění a jak jsou periferie nakonfigurovány. Pro dosažení požadované funkcionality propojuje více modulů z MCAL. Toto je poslední abstrakční vrstva BSP.

## Board Support Package

BSP je balíček orientovaný na hardware, který obsahuje vše potřebné pro inicializaci a používání všech periferií MCU a připojeného obvodu. Kromě tří výše uvedených vrstev obsahuje také **startup** kód (inicializace paměťových sekcí a volání aplikace) a generování **linker** scriptu pro vybrané MCU. Každá rodina STM32 má vlastní větev, takže rozhraní BSP zůstává stejné a mění se jen obsah pod ním.

```text
Application / Middleware
────────────────────────
          HAL            what is connected to which pin, how the board is configured
          MCAL           peripherals: Gpio, Usart, I2c, Dma, ...
          RAL            registers: CMSIS, ST LL drivers, unified Port layer
────────────────────────
         Hardware
```

Pravidlo je jednoduché: **vrstva volá pouze vrstvu bezprostředně pod sebou.** Aplikace nikdy neincluduje hlavičku ST, MCAL neví, který pin je LED, a RAL neví, k čemu se která periferie používá.

## Znovu blinky

Přepišme příklad. Aplikace nezná žádný hardware:

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

BSP zná desku a používá MCAL. Piny jsou popsány v jediné tabulce, takže nová revize PCB změní jeden řádek a nic jiného (zjednodušeno, ošetření chyb je vynecháno):

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

A někde úplně dole, uvnitř `Gpio_Set_PinLevel()`, funkce RAL `LL_GPIO_SetOutputPin()` konečně zapíše registr `BSRR`. Čtyři vrstvy pro blikající LED vypadají jako nesmysl, a pro blinky to nesmysl je. Ale jde o to, co se stane, když produkt poroste:

- **Nová rodina MCU:** vyzvedne se jiná větev BSP, aplikace se nedotkne.
- **Nová revize PCB:** LED se přesune na jiný pin, změní se jeden řádek v HAL.
- **Unit test aplikace:** BSP se nahradí falešným a aplikace běží na PC, bez jakéhokoli hardwaru.
- **Chyba v přístupu k registru:** je přesně na jednom místě.

## Kde to najít

Všechny zde popsané vrstvy jsou open source a zdokumentované, každá ve vlastním repozitáři organizace [Embedbits](https://github.com/Embedbits):

- [BSP](/docs/bsp): balíček se startupem, linker scriptem a HAL,
- [RAL](/docs/bsp/ral): CMSIS, CMSIS_ST a RAL_ST,
- [MCAL](/docs/bsp/mcal): periferní moduly spolu s tabulkou podporovaných rodin STM32,
- [coding style](/docs/platform/embi-platform/coding-style), díky kterému jsou názvy v těchto vrstvách čitelné.

Pokud chcete vidět stejnou myšlenku z pohledu jazyka, přečtěte si článek o [principech SOLID v C++ a C](/blog/solid-principles-c-cpp). Výše popsané vrstvy nejsou nic jiného než *dependency inversion* aplikovaná na celý firmware.

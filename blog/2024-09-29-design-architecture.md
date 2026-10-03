---
title: "Design & Architecture"
slug: design-architecture
date: 2024-09-29T20:59:52
authors: [Mr.Nobody]
tags: [embedded, architecture]
image: /img/blog/architecture-layers.png
---

OCD. Three great letters that force me to always think about software architecture. That can be really painful, especially if I have to deal with "Arduino" style architecture. You surely know it: the whole project in a few folders, the application in the *src* folder, the low level functionality in the *driver* folder and so on. But what to do in complex systems?

<!-- truncate -->

## Modularity

Every group of functionality shall be encapsulated in a package. By connecting such packages we get more and more complex systems. Imagine a project where you want to measure a temperature with a sensor connected to the ADC and send the actual data through the UART. We need a module that reads the raw data from the ADC, calculates the value in °C and provides it on its interface, and another module that handles the communication through the UART.

If we combined all of this functionality in a single place, we would determine the position and the speed of an elementary particle at the same time. That would cause the collapse of the wave function and the destruction of the universe (sarcasm).

## Abstraction layers

Imagine a tree. The top of the tree is a single point that handles or executes the needed functionality. In embedded systems it can be an infinite loop in the main function or some RTOS handler. The lower the tree goes, the wider it gets. This represents the connections and the hierarchy between the modules. The roots of the tree represent the connections to the hardware.

The basic example is the "blinky": the LED connected to PA1 shall be active if the button connected to PA0 is pressed, and vice versa.

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

We have mixed all the layers in this example. It can be acceptable for a primitive project, but in a complex system it leads to anarchy, mess, spaghetti code **and the end of the world**. To avoid a miserable, long and crucial armageddon, humans invented a few awesome things, like hierarchy and abstraction layers. In my projects I separate the functionality into three basic layers: Application, Middleware and Board Support Package (a.k.a. BSP). These are also split into multiple layers to achieve portability and modularity.

![Folder structure of a project: Application, Artifacts, Bsp (Hal, LinkerFiles, Mcal, Ral, Startup), Docs and Middlewares](/img/blog/architecture-layers.png)

The *Application* contains what the product does. The *Middleware* contains reusable software without hardware dependency, like a logger, a ModBus stack or a non-volatile memory manager. And what is the BSP? Easy. It contains everything needed for communication, configuration and handling of the hardware. From our example above, the GPIO operations belong to the BSP. The user shall not care about the exact connection of the button and the LED, so the interface between the BSP and the application can look like ***Bsp_Get_ButtonState()*** and ***Bsp_Set_LedState()***. If anything changes in the hardware, nobody has to edit multiple places and only the BSP is updated.

So the BSP contains at least one layer of encapsulation for these getters and setters. But what will they use? Will they write to the registers directly? I don't think so. STMicroelectronics has two sets of "drivers": the "HAL" and the "LL". Why the apostrophes? Because neither name is correct. Their "HAL" package is in reality a huge and slow spaghetti code which has nothing in common with its description, because HAL stands for Hardware Abstraction Layer. We will get to the real one at the end.

## Register Abstraction Layer (RAL)

The functions `LL_GPIO_xxx` from the example are an encapsulated access to the registers of the MCU. You can write register operations everywhere, but what if you change the MCU or make a mistake? You have to fix it in every single place. That would be painful, so we have just found the lowest abstraction layer, the *Register Abstraction Layer*. It represents only the abstraction of the registers, encapsulated in (usually inline) functions with meaningful names.

```c
__STATIC_INLINE void LL_GPIO_SetOutputPin(GPIO_TypeDef *GPIOx, uint32_t PinMask)
{
  WRITE_REG(GPIOx->BSRR, PinMask);
}
```

The name "LL" is from my point of view incorrect (same as their HAL, but who would use that?), but we get access to all registers with a meaningful description, so we can use it without difficult manual writing.

In my projects the RAL consists of three parts:

- **CMSIS** by ARM: the definitions of the Cortex-M core,
- **CMSIS_ST** by STMicroelectronics: the device headers with the register definitions and the system initialization of the MCU family,
- **RAL_ST**: the original LL drivers of ST together with my `Port` layer. The `Port` layer provides a unified naming that does not depend on the MCU family, so the code above the RAL does not change when the MCU does.

The RAL knows registers and nothing else. It does not know that something is connected to PA1.

## Microcontroller Abstraction Layer (MCAL)

So we have easy access to the registers. But what shall be next? Accessing a GPIO is trivial, but what about the other peripherals? For a transfer through the UART we need multiple registers for every operation: activate the peripheral, set the baudrate, the bit length, the parity, the stop bits and so on. And because we already know that every functionality which is used more than once shall be encapsulated, we create functions for reading errors, starting a transfer, writing to the output data register, reading the input data register and many more.

This functionality cannot be the RAL, because it is hierarchically higher and calls the RAL. It takes care only of the peripherals of the microcontroller, so the name of this layer is *Microcontroller Abstraction Layer* (MCAL). The user sees `Gpio_Set_PinLevel()` or `Usart_Send()` and does not need to know a single register. One peripheral, one interface: if the I2C needs the DMA, the I2C module handles it internally.

## Hardware Abstraction Layer (HAL)

Now we can initialize all peripherals of the MCU: RCC, DMA, USART/UART and so on. But the configuration has to be compatible with the devices connected on our PCB. So we are not focusing only on the MCU, but on the whole circuit. Thus we need another abstraction layer, the *Hardware Abstraction Layer* (HAL). Yes, this is the real meaning of the name, not like the "HAL" of ST.

The HAL is the only point of the interface between the application (or the middleware) and the hardware. It knows which pin is the LED, which UART is connected to the debug connector and how the peripherals are configured. To achieve the needed functionality it connects multiple modules from the MCAL. This is the last abstraction layer of the BSP.

## Board Support Package

The BSP is the hardware oriented package which contains everything necessary for the initialization and the usage of all peripherals of the MCU and of the connected circuit. Besides the three layers above it also contains the **startup** code (initialization of the memory sections and the call of the application) and the generation of the **linker** script for the selected MCU. Each STM32 family has its own branch, so the interface of the BSP stays the same and only the content below it changes.

```text
Application / Middleware
────────────────────────
          HAL            what is connected to which pin, how the board is configured
          MCAL           peripherals: Gpio, Usart, I2c, Dma, ...
          RAL            registers: CMSIS, ST LL drivers, unified Port layer
────────────────────────
         Hardware
```

The rule is simple: **a layer calls only the layer directly below it.** The application never includes an ST header, the MCAL does not know which pin is the LED, and the RAL does not know which peripheral is used for what.

## The blinky again

Let's rewrite the example. The application does not know any hardware:

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

The BSP knows the board and uses the MCAL. The pins are described in a single table, so a new revision of the PCB changes one line and nothing else (simplified, the error handling is omitted):

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

And somewhere at the bottom, inside `Gpio_Set_PinLevel()`, the RAL function `LL_GPIO_SetOutputPin()` finally writes the `BSRR` register. Four layers for a blinking LED looks like a nonsense, and for the blinky it is. But the point is what happens when the product grows:

- **A new MCU family:** another branch of the BSP is checked out, the application is not touched.
- **A new revision of the PCB:** the LED moves to another pin, one line in the HAL changes.
- **A unit test of the application:** the BSP is replaced by a fake one and the application runs on a PC, without any hardware.
- **A bug in a register access:** it is in exactly one place.

## Where to find it

All layers described here are open source and documented, each of them in its own repository of the [Embedbits](https://github.com/Embedbits) organization:

- [BSP](/docs/bsp): the package with the startup, the linker script and the HAL,
- [RAL](/docs/bsp/ral): CMSIS, CMSIS_ST and RAL_ST,
- [MCAL](/docs/bsp/mcal): the peripheral modules together with the table of supported STM32 families,
- the [coding style](/docs/platform/embi-platform/coding-style) that makes the names in these layers readable.

If you want to see the same idea from the point of view of the language, read the article about the [SOLID principles in C++ and C](/blog/solid-principles-c-cpp). The layers above are nothing else than the *dependency inversion* applied to the whole firmware.

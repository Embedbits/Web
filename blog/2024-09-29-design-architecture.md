---
title: "Design & Architecture"
slug: design-architecture
date: 2024-09-29T20:59:52
authors: [Mr.Nobody]
tags: [embedded, architecture]
image: /img/blog/architecture-layers.png
---

OCD. Three great letters that force me to always think about software architecture. That can be really painfull. Especially if i have to deal with “arduino” style architecture. You shure know it. Whole project in few folders, where application is placed in ***src*** folder, low level functionality is in ***driver*** folder and so on. But what to do in complex systems?

<!-- truncate -->

## Modularity

Every functionality group shall be encapsulated in packages. By connecting of this packages we will get more and more complex systems. Let’s you imagine a project, where you want measure temperature through NTC sensor connected to ADC and send actual data through UART. Thus we need module, which will read the RAW data from ADC, calculate value into °C and provide this values on module interface, and another module which will handle communication through UART.

If we would combine of this functionality at single place, we would determine the position and speed of elementary particle that would cause the wave function collapse and universe destruction (sarcasm).

## Abstraction layers

Lets imagine a tree. The top of tree is single point handling or executing needed functionality. In embedded systems it can be done by infinity loop in main function or some RTOS handler. The lower the tree goes, the wider it gets. This represents connections and hierarchy between different modules. The roots of the tree represents hardware connections.

The basic example can be the “blinky”. The LED connected to the PA1 shall be active if the button connected to PA0 is pressed and vice versa.

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

We have mixed all layers in this example which can be applicable for primitive projects, but in complex systems will this lead to anarchy, mess, spaghetti code **and end of the world**. To avoid misserable, long and crucial armageddon, humans invented a few awsome things. Like hierarchy and abstraction layers. In my projects i separate functionality into three basic layers. Application, Middleware and Board Support Packages (a.k.a. BSP). Those modules are also separated into multiple layers to achieve portability and modularity.

![Folder structure of a project: Application, Artifacts, Bsp (Hal, LinkerFiles, Mcal, Ral, Startup), Docs and Middlewares](/img/blog/architecture-layers.png)

Application is quite self-explaining, but what is BSP? Easy. It shall contain everything needed for communication, configuration and handling through hardware. From our example above, we shall locate GPIO operations in BSP. But user shall not care about exact connection of button and LED. So our interface between BSP and application shall look like ***Bsp_Get_ButtonState()*** and ***Bsp_Set_LedState()***. If anything will be changed on hardware, user dont need to implement this changes on multiple places and only BSP layer will be updated.

So BSP will contain at least one layer of encapsulation for this Getters and Setters. But what will they use? Will it write to registers directly? Dont think so. The ST Microelectronics has two sets of “drivers”. The “HAL” and “LL”. Why did i use apostrophes? Because neither one name is correct. Their “HAL” package is in reality huge and slow spaghetti code, which has nothing in common with their description. Shortcut HAL stands for Hardware Abstraction Layer.

The function’s LL_GPIO_xxx are representing encapsulated access to registers on MCU. You can write registers operations everywhere, but what if you change MCU or make a mistake? You shall change it on every single place. This shall be a painfull, so we have just found a lower abstraction layer “Register Abstraction Layer”. This layer shall represent only abstraction of registers encapsulated in (usually inline functions) functions with meaningfull names.

```c
__STATIC_INLINE void LL_GPIO_SetOutputPin(GPIO_TypeDef *GPIOx, uint32_t PinMask)
{
  WRITE_REG(GPIOx->BSRR, PinMask);
}
```

This naming “LL” is from my point of view incorrect (same like their HAL’s, but who would use it?). But we have ready access to all registers with meaningfull description, so we can use it without difficult manual writing.

So we have easy access to registers. But what shall be next? Accessing GPIO’s is trivial, but what about other peripherals? For example the transfer through UART we need to use multiple registers for every operation. We need to activate peripheral, set baudrate, bit length, parity, stop-bits and so on. And because we already know that every functionality, which will be used more than once, shall be encapsulated, we shall create functions for reading errors, starting transfer, writing to output data register, reading input data register and many more.

This functionality cannot be RAL, because it is hierarchically higher and calls RAL functionality. But this shall care only for peripherals on MicroController. So the name of this layer shall be MicroController Abstraction Layer (MCAL).

Now we can start initialization of all peripherals on MCU. We can trigger initialization of RCC, DMA, USART/UART and so on. But we need to set up the configuration, which will be compatible with connected devices on our PCB. So we are not focusing only on MCU, but on whole circuit. Thus we need another abstraction layer Hardware Abstraction Layer (HAL). Yes, this is the target functionality, not like the ST’s “HAL”.

This layer shall be the last abstraction layer in Board Support Packages (BSP) module.

### Board Support Packages

The hardware oriented module contain all necessary functionality for initialization and usage of all peripherals on MCU and connected circuit. This layer is separated into three basic layers:

- Register Abstraction Layer (RAL)
- MicroController Abstraction Layer (MCAL)
- Hardware Abstraction Layer (HAL)

#### Hardware Abstraction Layer (HAL)

Board Support Packages abstraction layer top entity. In human language, this shall be the only point of interface between application or middleware and hardware. Also we need to connect multiple functionalities from MCAL layer to achieve needed functionality.

#### Micro-Controller Abstraction Layer (MCAL)

Abstraction layer which shall encapsualte multiple register access in single place. If we want to use GPIO peripheral on MCU, we need to activate clock, power, set pin type, pin direction and some other needed stuff. Initialize the peripheral in short.

#### Register Abstraction Layer (RAL)

To be continued…

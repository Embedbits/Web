---
title: "Design & Architecture"
slug: design-architecture
date: 2024-09-29T20:59:52
authors: [Mr.Nobody]
tags: [embedded]
---

OCD. Three great letters that force me to always think about software architecture. That can be really painfull. Especially if i have to deal with “arduino” style architecture. You shure know it. Whole project in few folders, where application is placed in ***src*** folder, low level functionality is in ***driver*** folder and so on. But what to do in complex systems?

<!-- truncate -->

```c
#include "stm32g4xx_ll_gpio.h"

if(0u != LL_GPIO_IsInputPinSet(GPIOA, LL_GPIO_PIN_0))
{
  LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_1);
}
else
{
  LL_GPIO_ResetOutputPin(GPIOA, LL_GPIO_PIN_1);
}
```

This style can be applicable for primitive projects, but in complex systems will this lead to anarchy, mess, spaghetti code **and end of the world**. To avoid misserable, long and crucial armageddon, humans invented a few awsome things. Like hierarchy and abstraction layers.

In embedded systems there is usually two top-level entities. Application and Board Support Packeges (a.k.a. BSP). Application is quite self-explaining, but what is BSP? Easy. It shall contain everything needed for communication, configuration and handling through hardware. From our example above, we shall locate GPIO operations in BSP. But user shall not care about exact connection of button and LED. So our interface between BSP and application shall look like ***Bsp_Get_ButtonState()*** and ***Bsp_Set_LedState()***. If anything will be changed on hardware, user dont need to implement this changes on multiple places and only BSP layer will be updated.

So BSP will contain at least one layer of encapsulation for this Getters and Setters. But what will they use? Will it write to registers directly? Dont think so. The ST Microelectronics has two sets of “drivers”. The “HAL” and “LL”. Why did i use apostrophes? Because neither one name is correct. Their “HAL” package is in reality huge and slow spaghetti code, which has nothing in common with their description. Shortcut HAL stands for Hardware Abstraction Layer.

This module shall represent complete abstraction layer for operations with hardware peripherals, MCU configuration all HW oriented part of project. Lets imagine a standard “blinky” project where you want to turn on the LED, if button is pressed, and vice-versa. You can write a simple code:

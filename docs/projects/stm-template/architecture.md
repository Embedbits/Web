---
sidebar_position: 2
---

# Architecture

STM Template separates the project into several logical layers.

## Application

Contains application-specific functionality.

## Middleware

Contains reusable software components that are independent of a specific MCU peripheral implementation.

## BSP

The Board Support Package provides the hardware-specific implementation.

The BSP is further divided into:

- Linker
- Startup
- MCAL
- RAL
- HAL

## RAL

RAL provides a controlled interface around vendor-specific low-level libraries such as CMSIS and STM32 LL.

## MCAL

MCAL provides MCU peripheral abstractions used by higher layers.

## Build system

CMake is used to configure and build the project.

The same project structure can be used for embedded targets and host-based unit tests.
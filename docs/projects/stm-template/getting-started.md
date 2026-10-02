---
sidebar_position: 3
---

# Getting Started

## Prerequisites

The development environment requires:

- Git
- CMake
- Ninja
- A supported compiler toolchain (see [Artifacts](../../artifacts/overview.md), which downloads the toolchain automatically)
- Doxygen for documentation generation

## Project setup

Add [EmBi_Platform](../../platform/embi-platform.md) to the project root as a Git submodule:

```bash
git submodule add https://github.com/Embedbits/EmBi_Platform ./EmBi_Platform
```

Then run the setup script and pick the options in the menu.

On Windows:

```bash
Setup.bat
```

On Linux / macOS:

```bash
./Setup.sh
```

The recommended order is:

1. **Initialize project necessary files**: copies `CMakeLists.txt` and `ArtifactsConfig.txt`.
2. **Initialize STM32CubeIDE project**: optional IDE project.
3. **Configure application layer**: creates the application folder structure.
4. **Configure BSP module**: select the STM32 family (for example `STM32G4`).
5. **Configure Middleware module**: add middleware components such as FreeRTOS or u8g2.

See the [EmBi_Platform](../../platform/embi-platform.md) page for details on each option.

## Build

Create a build directory and configure the project with CMake:

```bash
cmake -S . -B build -G Ninja
cmake --build build
```

The exact configuration depends on the selected target and toolchain.

## Documentation

Doxygen can be used to generate API documentation from the source code.

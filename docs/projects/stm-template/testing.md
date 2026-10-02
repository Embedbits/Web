# Testing

STM Template supports both embedded-target builds and host-based unit testing.

## Unit tests

Unit tests are implemented using Unity.

Tests can be executed on the host without requiring the target MCU.

## CTest

CTest is used to integrate unit tests into the CMake build system.

A typical test workflow is:

```bash
cmake --build build
ctest --test-dir build
```

Embedded testing

Embedded-target tests can be combined with hardware-specific integration tests.

This allows the same project to distinguish between:

Host unit tests
Target integration tests
Hardware compatibility tests

---
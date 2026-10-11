---
title: "Reproducible builds: pin the tools, pin the sources, remove the clock"
slug: reproducible-builds-embedded
date: 2026-10-07T14:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, architecture]
---

A customer calls about a firmware that you delivered fourteen months ago. You check out the tag, build it, flash it and the bug is not there. Is the bug gone, or is it a different firmware? If your build is not **reproducible**, you cannot tell. Nobody can tell, because the binary that you have just built differs from the delivered one in ways that you can neither see nor explain: another version of the compiler, a library that was updated on the PC, the path of the folder, the time of the day.

A reproducible build has a simple definition: **the same inputs give the same bytes**. This article shows what the inputs of a firmware build are, how the Embedbits platform pins them (the Artifacts Handler), and an experiment that I did: two builds of the same source, in two folders at two different times, give two different binaries. Then three changes later they give the same one, to the last bit.

<!-- truncate -->

## The inputs of a build

A build is a function. What goes into it?

| Input | Where it comes from | How to pin it |
|---|---|---|
| **The source** | Git | a tag or a commit, the submodules pinned by their commits |
| **The tools** (compiler, linker, Ninja, Doxygen) | installed on the PC, or fetched | exact versions, from one source |
| **The build description** (flags, linker script) | CMake files | in the repository, nothing set by hand |
| **The platform scripts** | the EmBi_Platform submodule | the submodule commit, updated by the Updater, deliberately |
| **The environment** | the PC | nothing in the output should depend on it: the path, the time, the user name |

The first, third and fourth are in Git, so they are pinned by design. The tools and the environment are where a build usually breaks, and each of them has its own answer.

## The tools: the Artifacts Handler

"Install GCC 13.2 and Ninja 1.12" in a README is a sentence that nobody follows to the letter. The platform solves it by making the tools a part of the project. The Artifacts Handler is a CMake script that reads a list of the tools and their versions from a file, `ArtifactsConfig.txt`, and prepares them. Its documentation says that the only software that the user needs is Git and CMake, and that every other component of the build is delivered by the handler. In steps:

1. **Clone** the root repository of the artifacts (without the submodules, to save the traffic).
2. **Locate** the artifact in it (every tool is a submodule, the names are compared without the case).
3. **Check out** the requested version (a shallow clone, `--depth=1`). The releases are tagged by the version and the operating system (`Win`, `Unix`, `DarwinARM`).
4. **Install** it: unpack the archive into the cache folder.
5. **Initialize** it: in most cases it puts the folder of the tool at the *beginning* of the `PATH`, so the project tool wins over any tool installed in the system.

The configuration has one line for each tool, `name;version;handler version`, for example the lines from the platform documentation:

```text
ninja;1.12.1;1
gcc-arm-none-eabi;13.2.rel1;2
```

The first number is the version of the tool itself (the *binary*), the second one is the version of the handler script of that artifact (it can change independently, for example when the way of setting the `PATH` is fixed). The cache has one folder per tool and per version, so several versions live side by side and a project that needs the older one does not disturb the project that needs the newer.

### Why not `latest`

The handler also accepts `latest` instead of a number. It is comfortable and it breaks the whole idea. I ran the handler with the line `ninja;latest;latest`, and it printed what it resolved it to on 5 October 2026:

```text
-- Processing artifact ninja with Bin version latest and Core version latest.
-- The version 1.0.0 of artifacts Core part will be used.
-- The version 1.13.2 of artifacts Bin part will be used.
```

(The run stopped at the download of the release, because my environment cannot reach the GitHub API, but the resolution happened.) `latest` is a **moving target**: with the documentation saying that the list of the versions is downloaded once a day, the same file gives the 1.13.2 today and something else after the next release. A build that is correct today can be a different build tomorrow, and nothing in your repository says so. The rule is therefore simple: **`latest` is for trying a new version, and a released project pins every number.**

### The other settings that help

- **An offline mode** (`-DOFFLINE_MODE=true`): only the local cache is checked and nothing is downloaded. It is the way to prove that the build does not depend on the network, and the way to build in a place where the network is not.
- **The location of the cache** (`ARTIFACTS_HANDLER_CACHE_PATH`) and **of the root repository** (`ARTIFACTS_HANDLER_ROOT_REPO_URL`) can be set in the configuration file, in the environment or on the command line. A company can run its own mirror of the artifacts, so the build does not depend on a public server either.
- **A checksum.** Each release of an artifact is published with a SHA-256 file next to the archive, so a corrupted or exchanged file is not accepted silently.

The tools are the first half of the answer. The second half is something that you can check yourself, with the command below.

## The environment: an experiment

I took the example project from the article about [CMake](/blog/cmake-for-embedded-firmware) and added a file that most firmwares have in some form: the **build information**. It stores the time of the build and the path of the source file, because someone once wanted to see "when was this built" in the debugger:

```c
const char buildFile[] = __FILE__;
const char buildTime[] = __DATE__ " " __TIME__;
```

Then I built the same source twice: in two different folders (`a` and `b`), the second one three seconds later. The `strings` command applied to the two binaries shows what is inside:

```text
Oct  5 2026 15:46:02
/tmp/.../repro/a/Application/BuildInfo.c
---
Oct  5 2026 15:46:05
/tmp/.../repro/b/Application/BuildInfo.c
```

and the SHA-256 of the two `firmware.bin` files differ:

```text
f2366319462b6fee...
d634c24c3c431799...
```

Two builds of one source, two different binaries. The time is obvious, but the **path** is the one that people forget: `__FILE__` (and also `assert()` and the debug information) writes the full path of the file into the program, and the path is different on the PC of every developer and in every CI job. A binary built in `/home/anna/project` and the same one built in `/builds/job-4711/project` are two different files.

### Three changes

**1. Remove the clock.** The macros `__DATE__` and `__TIME__` have no place in a firmware that has to be reproducible. The compiler can enforce it, so nobody adds them back by accident:

```text
BuildInfo.c:5:26: error: macro "__DATE__" might prevent reproducible builds [-Werror=date-time]
BuildInfo.c:5:39: error: macro "__TIME__" might prevent reproducible builds [-Werror=date-time]
```

**2. The version is an input.** If you want to know "what is this firmware", the build gets the answer from the outside: a version, a tag or a commit hash that the build system passes as a definition. The same source has the same version, so the same bytes:

```c
#ifndef BUILD_VERSION
#define BUILD_VERSION "unknown"
#endif

const char buildVersion[] = BUILD_VERSION;
```

**3. Remove the paths.** The option `-ffile-prefix-map=OLD=NEW` replaces the prefix of every path that GCC puts into the output (`__FILE__`, the debug information, the assertions). The source folder of the project is replaced by a dot:

```cmake title="CMakeLists.txt (a part)"
# The version of the firmware is an input of the build, not the time of the build.
set(FIRMWARE_VERSION "1.2.3" CACHE STRING "Version of the firmware")
add_compile_definitions(BUILD_VERSION="${FIRMWARE_VERSION}")

# No clock in the binary, and no path of this PC in it.
add_compile_options(${MCU_FLAGS} ${WARNING_FLAGS} ${BUILD_OPTIONS}
                    -Wdate-time -Werror=date-time
                    -ffile-prefix-map=${CMAKE_SOURCE_DIR}=.)
```

With these three, the same check gives:

```text
first : 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
second: 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
REPRODUCIBLE
```

The `.bin` is identical, and so is the `.elf`, in the release (`-Os -g0`) and also in the debug build (`-Og -g3`), whose debug information is full of paths. With `-ffile-prefix-map` the `strings` of the binary shows `./Application/BuildInfo.c` and the version `1.2.3`, and nothing about the PC that built it.

## A test that never gets old

It is not enough to make a build reproducible once, because the first `__TIME__` that somebody adds destroys it. So make it a **test**: build the source twice and compare. This is the script that I used for the numbers above; it copies the project into two folders, builds both with a pause between and compares the SHA-256:

```bash title="check-reproducible.sh"
#!/usr/bin/env bash
# Builds the same source twice, in two different folders, and compares the firmware.
set -euo pipefail

source_dir="$(cd "$1" && pwd)"
config="${2:-Release}"
work="$(mktemp -d)"

for copy in first second; do
    cp -r "$source_dir" "$work/$copy"
    rm -rf "$work/$copy/build"
    cmake -S "$work/$copy" -B "$work/$copy/build" -G Ninja \
          -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DCMAKE_BUILD_TYPE="$config" > /dev/null
    cmake --build "$work/$copy/build" > /dev/null
    sleep 2                                    # the second build is later and is in another folder
done

first="$(sha256sum "$work/first/build/firmware.bin" | cut -d' ' -f1)"
second="$(sha256sum "$work/second/build/firmware.bin" | cut -d' ' -f1)"

echo "first : $first"
echo "second: $second"
if [ "$first" = "$second" ]; then echo "REPRODUCIBLE"; else echo "NOT REPRODUCIBLE"; exit 1; fi
```

Run in the CI on every merge, it is the guard. I used it on the broken version of the build information too, to be sure that it can fail, and it did (`NOT REPRODUCIBLE`, exit code 1, two different hashes). A test that has never failed is a test that you do not know.

## What else breaks a reproducible build

I tested the three things above. The following are the other well-known sources of the trouble that you should keep in mind (I did not need them in the example, so I only name them):

- **The order of files** that comes from a `file(GLOB ...)` or from a directory listing. The sources should be listed explicitly, as in the CMake files of the platform modules.
- **A timestamp in an archive** (a static library made by `ar`). The modern versions of the tools have a deterministic mode, but an old toolchain may not.
- **Generated code.** The mocks and the runners of the unit tests, or the linker script generated for an MCU, have to be generated the same way from the same inputs. Sorting and no timestamps in the output are the rules.
- **The compiler itself.** The same version of the same compiler from two sources (a distribution package and an archive of the vendor) can differ in the libraries it links. That is the reason to take the compiler from one place, which is the whole point of the artifacts.
- **The build with a different number of threads.** A correct build system gives the same result with `-j1` and `-j16`, and a test of that is a cheap addition to the one above.

## A checklist

1. Every tool is pinned to an exact version in `ArtifactsConfig.txt`. No `latest` in a release.
2. The submodules (the BSP, the platform) are pinned by commits, and the update is a visible commit.
3. Nothing in the firmware depends on the time or the path: `-Werror=date-time`, `-ffile-prefix-map`.
4. The version is a parameter of the build, derived from a tag, and is stored in the firmware.
5. The CI builds twice and compares. It also builds offline, from the cache, once in a while.
6. The delivered binary is stored together with its SHA-256 and the tag, so "is it the same file" has an answer without a rebuild.

The reward is a sentence that you will use at the telephone with the customer: *"I have built exactly your firmware, and the bug is (not) in it."*

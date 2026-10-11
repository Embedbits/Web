---
title: "Reprodukovatelné buildy: připněte nástroje, připněte zdroje, odstraňte hodiny"
slug: reproducible-builds-embedded
date: 2026-10-07T14:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, architecture]
---

Zákazník volá kvůli firmware, který jste dodali před čtrnácti měsíci. Vyberete tag, přeložíte ho, nahrajete a chyba tam není. Zmizela chyba, nebo je to jiný firmware? Pokud váš build není **reprodukovatelný**, nedokážete to říct. Nikdo to nedokáže, protože binárka, kterou jste právě přeložili, se od dodané liší způsoby, které nevidíte ani nedokážete vysvětlit: jiná verze překladače, knihovna aktualizovaná na PC, cesta ke složce, denní doba.

Reprodukovatelný build má jednoduchou definici: **stejné vstupy dají stejné bajty**. Tento článek ukazuje, jaké jsou vstupy buildu firmware, jak je platforma Embedbits připíná (Artifacts Handler) a experiment, který jsem udělal: dva buildy stejného zdroje, ve dvou složkách ve dvou různých časech, dají dvě různé binárky. Po třech změnách pak dají tu samou, co do posledního bitu.

<!-- truncate -->

## Vstupy buildu

Build je funkce. Co do ní vstupuje?

| Vstup | Odkud pochází | Jak ho připnout |
|---|---|---|
| **Zdroj** | Git | tag nebo commit, submoduly připnuté svými commity |
| **Nástroje** (překladač, linker, Ninja, Doxygen) | nainstalované na PC, nebo stažené | přesné verze z jednoho zdroje |
| **Popis buildu** (flagy, linker script) | soubory CMake | v repozitáři, nic nastavené ručně |
| **Skripty platformy** | submodul EmBi_Platform | commit submodulu, aktualizovaný pomocí Updateru, záměrně |
| **Prostředí** | PC | nic na výstupu by na něm nemělo záviset: cesta, čas, jméno uživatele |

První, třetí a čtvrtý vstup jsou v Gitu, takže jsou připnuté už návrhem. Nástroje a prostředí jsou místa, kde se build obvykle rozbije, a každé z nich má vlastní odpověď.

## Nástroje: Artifacts Handler

„Nainstalujte GCC 13.2 a Ninja 1.12“ v README je věta, kterou nikdo nedodržuje doslova. Platforma to řeší tím, že z nástrojů dělá součást projektu. Artifacts Handler je skript CMake, který ze souboru `ArtifactsConfig.txt` přečte seznam nástrojů a jejich verzí a připraví je. Jeho dokumentace uvádí, že jediný software, který uživatel potřebuje, je Git a CMake, a že každou další komponentu buildu dodá handler. Po krocích:

1. **Naklonuje** kořenový repozitář artefaktů (bez submodulů, aby se ušetřil provoz).
2. **Najde** v něm artefakt (každý nástroj je submodul, názvy se porovnávají bez ohledu na velikost písmen).
3. **Checkoutne** požadovanou verzi (mělký klon, `--depth=1`). Vydání jsou označena tagem podle verze a operačního systému (`Win`, `Unix`, `DarwinARM`).
4. **Nainstaluje** ho: rozbalí archiv do složky cache.
5. **Inicializuje** ho: ve většině případů vloží složku nástroje na *začátek* `PATH`, takže nástroj projektu vyhraje nad jakýmkoli nástrojem nainstalovaným v systému.

Konfigurace má jeden řádek na nástroj, `name;version;handler version`, například řádky z dokumentace platformy:

```text
ninja;1.12.1;1
gcc-arm-none-eabi;13.2.rel1;2
```

První číslo je verze samotného nástroje (*binárky*), druhé je verze skriptu handleru daného artefaktu (může se měnit nezávisle, například když se opraví způsob nastavení `PATH`). Cache má jednu složku na nástroj a verzi, takže několik verzí žije vedle sebe a projekt, který potřebuje starší, neruší projekt, který potřebuje novější.

### Proč ne `latest`

Handler také přijímá `latest` místo čísla. Je to pohodlné a rozbíjí to celou myšlenku. Spustil jsem handler s řádkem `ninja;latest;latest` a vypsal, na co to 5. října 2026 přeložil:

```text
-- Processing artifact ninja with Bin version latest and Core version latest.
-- The version 1.0.0 of artifacts Core part will be used.
-- The version 1.13.2 of artifacts Bin part will be used.
```

(Běh se zastavil při stahování vydání, protože moje prostředí nedosáhne na GitHub API, ale vyřešení proběhlo.) `latest` je **pohyblivý cíl**: dokumentace říká, že seznam verzí se stahuje jednou denně, takže stejný soubor dnes dá 1.13.2 a po dalším vydání něco jiného. Build, který je dnes správný, může být zítra jiný build a nic ve vašem repozitáři to neříká. Pravidlo je proto jednoduché: **`latest` je pro zkoušení nové verze a vydaný projekt připíná každé číslo.**

### Další nastavení, která pomáhají

- **Offline režim** (`-DOFFLINE_MODE=true`): kontroluje se jen lokální cache a nic se nestahuje. Je to způsob, jak dokázat, že build nezávisí na síti, a způsob, jak stavět tam, kde síť není.
- **Umístění cache** (`ARTIFACTS_HANDLER_CACHE_PATH`) a **kořenového repozitáře** (`ARTIFACTS_HANDLER_ROOT_REPO_URL`) lze nastavit v konfiguračním souboru, v prostředí nebo na příkazové řádce. Firma může provozovat vlastní zrcadlo artefaktů, takže build nezávisí ani na veřejném serveru.
- **Kontrolní součet.** Každé vydání artefaktu je publikováno se souborem SHA-256 vedle archivu, takže poškozený nebo vyměněný soubor není tiše přijat.

Nástroje jsou první polovina odpovědi. Druhá polovina je něco, co si můžete ověřit sami, pomocí příkazu níže.

## Prostředí: experiment

Vzal jsem ukázkový projekt z článku o [CMake](/blog/cmake-for-embedded-firmware) a přidal soubor, který má většina firmware v nějaké podobě: **informace o buildu**. Ukládá čas buildu a cestu ke zdrojovému souboru, protože někdo kdysi chtěl v debuggeru vidět „kdy se to přeložilo“:

```c
const char buildFile[] = __FILE__;
const char buildTime[] = __DATE__ " " __TIME__;
```

Pak jsem stejný zdroj přeložil dvakrát: ve dvou různých složkách (`a` a `b`), druhý o tři sekundy později. Příkaz `strings` použitý na obě binárky ukazuje, co je uvnitř:

```text
Oct  5 2026 15:46:02
/tmp/.../repro/a/Application/BuildInfo.c
---
Oct  5 2026 15:46:05
/tmp/.../repro/b/Application/BuildInfo.c
```

a SHA-256 obou souborů `firmware.bin` se liší:

```text
f2366319462b6fee...
d634c24c3c431799...
```

Dva buildy jednoho zdroje, dvě různé binárky. Čas je zřejmý, ale **cesta** je ta, na kterou lidé zapomínají: `__FILE__` (a také `assert()` a ladicí informace) zapisuje do programu plnou cestu k souboru a cesta je jiná na PC každého vývojáře a v každé úloze CI. Binárka přeložená v `/home/anna/project` a ta samá přeložená v `/builds/job-4711/project` jsou dva různé soubory.

### Tři změny

**1. Odstraňte hodiny.** Makra `__DATE__` a `__TIME__` nemají místo ve firmware, který má být reprodukovatelný. Překladač to dokáže vynutit, takže je nikdo omylem nepřidá zpět:

```text
BuildInfo.c:5:26: error: macro "__DATE__" might prevent reproducible builds [-Werror=date-time]
BuildInfo.c:5:39: error: macro "__TIME__" might prevent reproducible builds [-Werror=date-time]
```

**2. Verze je vstup.** Pokud chcete vědět, „co je to za firmware“, build dostane odpověď zvenku: verzi, tag nebo hash commitu, který build systém předá jako definici. Stejný zdroj má stejnou verzi, tedy stejné bajty:

```c
#ifndef BUILD_VERSION
#define BUILD_VERSION "unknown"
#endif

const char buildVersion[] = BUILD_VERSION;
```

**3. Odstraňte cesty.** Volba `-ffile-prefix-map=OLD=NEW` nahradí prefix každé cesty, kterou GCC vloží do výstupu (`__FILE__`, ladicí informace, aserce). Zdrojová složka projektu se nahradí tečkou:

```cmake title="CMakeLists.txt (a part)"
# The version of the firmware is an input of the build, not the time of the build.
set(FIRMWARE_VERSION "1.2.3" CACHE STRING "Version of the firmware")
add_compile_definitions(BUILD_VERSION="${FIRMWARE_VERSION}")

# No clock in the binary, and no path of this PC in it.
add_compile_options(${MCU_FLAGS} ${WARNING_FLAGS} ${BUILD_OPTIONS}
                    -Wdate-time -Werror=date-time
                    -ffile-prefix-map=${CMAKE_SOURCE_DIR}=.)
```

S těmito třemi změnami dá stejná kontrola:

```text
first : 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
second: 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
REPRODUCIBLE
```

`.bin` je identický, stejně jako `.elf`, v release (`-Os -g0`) i v debug buildu (`-Og -g3`), jehož ladicí informace jsou plné cest. Díky `-ffile-prefix-map` ukazuje `strings` binárky `./Application/BuildInfo.c` a verzi `1.2.3` a nic o PC, které ji přeložilo.

## Test, který nezestárne

Nestačí udělat build reprodukovatelným jednou, protože první `__TIME__`, který někdo přidá, ho zničí. Udělejte z něj proto **test**: přeložte zdroj dvakrát a porovnejte. Tohle je skript, kterým jsem získal čísla výše; zkopíruje projekt do dvou složek, přeloží oba s pauzou mezi nimi a porovná SHA-256:

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

Spouštěný v CI při každém mergi je strážcem. Použil jsem ho i na rozbitou verzi informací o buildu, abych si byl jistý, že umí selhat, a selhal (`NOT REPRODUCIBLE`, návratový kód 1, dva různé hashe). Test, který nikdy neselhal, je test, který neznáte.

## Co dalšího reprodukovatelný build rozbíjí

Otestoval jsem tři věci výše. Následující jsou další dobře známé zdroje potíží, které byste měli mít na paměti (v příkladu jsem je nepotřeboval, takže je jen jmenuji):

- **Pořadí souborů** pocházející z `file(GLOB ...)` nebo z výpisu adresáře. Zdroje by měly být vypsané explicitně, jako v souborech CMake modulů platformy.
- **Časové razítko v archivu** (statická knihovna vytvořená `ar`). Moderní verze nástrojů mají deterministický režim, ale starý toolchain ho mít nemusí.
- **Generovaný kód.** Mocky a runnery unit testů nebo linker script generovaný pro MCU se musí generovat stejně ze stejných vstupů. Pravidla jsou řazení a žádná časová razítka na výstupu.
- **Samotný překladač.** Stejná verze stejného překladače ze dvou zdrojů (balíček distribuce a archiv výrobce) se může lišit v knihovnách, které linkuje. To je důvod, proč brát překladač z jednoho místa, což je smyslem artefaktů.
- **Build s jiným počtem vláken.** Správný build systém dá stejný výsledek s `-j1` i `-j16` a test toho je levným doplňkem k tomu výše.

## Kontrolní seznam

1. Každý nástroj je v `ArtifactsConfig.txt` připnutý na přesnou verzi. Žádné `latest` ve vydání.
2. Submoduly (BSP, platforma) jsou připnuté commity a aktualizace je viditelný commit.
3. Nic ve firmware nezávisí na čase ani cestě: `-Werror=date-time`, `-ffile-prefix-map`.
4. Verze je parametr buildu, odvozený z tagu, a je uložená ve firmware.
5. CI staví dvakrát a porovnává. Čas od času také staví offline, z cache.
6. Dodaná binárka je uložena spolu se svým SHA-256 a tagem, takže otázka „je to stejný soubor“ má odpověď bez nového buildu.

Odměnou je věta, kterou použijete do telefonu se zákazníkem: *„Přeložil jsem přesně váš firmware a chyba v něm (ne)je.“*

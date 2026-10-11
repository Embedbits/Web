---
title: "Reprodukovateľné buildy: pripnite nástroje, pripnite zdrojáky, odstráňte hodiny"
slug: reproducible-builds-embedded
date: 2026-10-07T14:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, architecture]
---

Zákazník volá kvôli firmvéru, ktorý ste dodali pred štrnástimi mesiacmi. Checkoutnete tag, zostavíte ho, nahráte a chyba tam nie je. Zmizla chyba, alebo je to iný firmvér? Ak váš build nie je **reprodukovateľný**, nemôžete to povedať. Nemôže to povedať nikto, pretože binárka, ktorú ste práve zostavili, sa líši od dodanej spôsobmi, ktoré nevidíte ani nedokážete vysvetliť: iná verzia kompilátora, knižnica aktualizovaná na PC, cesta k priečinku, denná doba.

Reprodukovateľný build má jednoduchú definíciu: **rovnaké vstupy dajú rovnaké bajty**. Tento článok ukazuje, aké sú vstupy buildu firmvéru, ako ich platforma Embedbits pripína (Artifacts Handler) a experiment, ktorý som urobil: dva buildy toho istého zdrojáka v dvoch priečinkoch v dvoch rôznych časoch dajú dve rôzne binárky. Potom o tri zmeny neskôr dajú tú istú, až na posledný bit.

<!-- truncate -->

## Vstupy buildu

Build je funkcia. Čo do nej vstupuje?

| Vstup | Odkiaľ pochádza | Ako ho pripnúť |
|---|---|---|
| **Zdroják** | Git | tag alebo commit, submoduly pripnuté svojimi commitmi |
| **Nástroje** (kompilátor, linker, Ninja, Doxygen) | nainštalované na PC alebo stiahnuté | presné verzie z jedného zdroja |
| **Popis buildu** (flagy, linker script) | súbory CMake | v repozitári, nič nenastavené ručne |
| **Skripty platformy** | submodul EmBi_Platform | commit submodulu, aktualizovaný nástrojom Updater, zámerne |
| **Prostredie** | PC | nič vo výstupe by na ňom nemalo závisieť: cesta, čas, meno používateľa |

Prvý, tretí a štvrtý sú v Gite, takže sú pripnuté už návrhom. Nástroje a prostredie sú miesta, kde sa build zvyčajne rozpadne, a každé z nich má vlastnú odpoveď.

## Nástroje: Artifacts Handler

„Nainštalujte GCC 13.2 a Ninja 1.12“ v README je veta, ktorú nikto nedodrží do písmena. Platforma to rieši tak, že z nástrojov urobí súčasť projektu. Artifacts Handler je skript CMake, ktorý zo súboru `ArtifactsConfig.txt` číta zoznam nástrojov a ich verzií a pripravuje ich. Jeho dokumentácia hovorí, že jediný softvér, ktorý používateľ potrebuje, je Git a CMake a každú ďalšiu súčasť buildu dodá handler. V krokoch:

1. **Naklonuje** koreňový repozitár artefaktov (bez submodulov, aby sa ušetrila prevádzka).
2. **Nájde** v ňom artefakt (každý nástroj je submodul, názvy sa porovnávajú bez ohľadu na veľkosť písmen).
3. **Checkoutne** požadovanú verziu (plytký klon, `--depth=1`). Vydania sú označené verziou a operačným systémom (`Win`, `Unix`, `DarwinARM`).
4. **Nainštaluje** ho: rozbalí archív do priečinka cache.
5. **Inicializuje** ho: vo väčšine prípadov dá priečinok nástroja na *začiatok* `PATH`, takže projektový nástroj vyhrá nad akýmkoľvek nástrojom nainštalovaným v systéme.

Konfigurácia má jeden riadok pre každý nástroj, `name;version;handler version`, napríklad riadky z dokumentácie platformy:

```text
ninja;1.12.1;1
gcc-arm-none-eabi;13.2.rel1;2
```

Prvé číslo je verzia samotného nástroja (*binárky*), druhé je verzia handler skriptu daného artefaktu (môže sa meniť nezávisle, napríklad keď sa opraví spôsob nastavenia `PATH`). Cache má jeden priečinok na nástroj a verziu, takže viaceré verzie žijú vedľa seba a projekt, ktorý potrebuje staršiu, neruší projekt, ktorý potrebuje novšiu.

### Prečo nie `latest`

Handler akceptuje aj `latest` namiesto čísla. Je to pohodlné a rozbíja to celú myšlienku. Spustil som handler s riadkom `ninja;latest;latest` a vypísal, na čo to 5. októbra 2026 rozlíšil:

```text
-- Processing artifact ninja with Bin version latest and Core version latest.
-- The version 1.0.0 of artifacts Core part will be used.
-- The version 1.13.2 of artifacts Bin part will be used.
```

(Beh sa zastavil pri sťahovaní vydania, pretože moje prostredie sa nedokáže dostať k GitHub API, ale rozlíšenie prebehlo.) `latest` je **pohyblivý cieľ**: podľa dokumentácie sa zoznam verzií sťahuje raz za deň, takže ten istý súbor dá dnes 1.13.2 a po ďalšom vydaní niečo iné. Build, ktorý je dnes správny, môže byť zajtra iný build a nič vo vašom repozitári to nepovie. Pravidlo je preto jednoduché: **`latest` je na vyskúšanie novej verzie a vydaný projekt pripína každé číslo.**

### Ďalšie nastavenia, ktoré pomáhajú

- **Offline režim** (`-DOFFLINE_MODE=true`): kontroluje sa len lokálna cache a nič sa nesťahuje. Je to spôsob, ako dokázať, že build nezávisí od siete, a spôsob, ako zostavovať na mieste, kde sieť nie je.
- **Umiestnenie cache** (`ARTIFACTS_HANDLER_CACHE_PATH`) a **koreňového repozitára** (`ARTIFACTS_HANDLER_ROOT_REPO_URL`) sa dajú nastaviť v konfiguračnom súbore, v prostredí alebo na príkazovom riadku. Firma môže prevádzkovať vlastné zrkadlo artefaktov, takže build nezávisí ani od verejného servera.
- **Kontrolný súčet.** Každé vydanie artefaktu sa publikuje so súborom SHA-256 vedľa archívu, takže poškodený alebo vymenený súbor sa neprijme potichu.

Nástroje sú prvá polovica odpovede. Druhá polovica je niečo, čo si môžete overiť sami, príkazom nižšie.

## Prostredie: experiment

Vzal som príkladový projekt z článku o [CMake](/blog/cmake-for-embedded-firmware) a pridal súbor, ktorý má väčšina firmvérov v nejakej podobe: **informácie o builde**. Ukladá čas buildu a cestu zdrojového súboru, pretože niekto kedysi chcel v debuggeri vidieť „kedy sa to zostavilo“:

```c
const char buildFile[] = __FILE__;
const char buildTime[] = __DATE__ " " __TIME__;
```

Potom som ten istý zdroják zostavil dvakrát: v dvoch rôznych priečinkoch (`a` a `b`), druhý o tri sekundy neskôr. Príkaz `strings` aplikovaný na obe binárky ukazuje, čo je vnútri:

```text
Oct  5 2026 15:46:02
/tmp/.../repro/a/Application/BuildInfo.c
---
Oct  5 2026 15:46:05
/tmp/.../repro/b/Application/BuildInfo.c
```

a SHA-256 oboch súborov `firmware.bin` sa líši:

```text
f2366319462b6fee...
d634c24c3c431799...
```

Dva buildy jedného zdrojáka, dve rôzne binárky. Čas je zrejmý, ale **cesta** je tá, na ktorú ľudia zabúdajú: `__FILE__` (a tiež `assert()` a ladiace informácie) zapisuje do programu plnú cestu k súboru a cesta je iná na PC každého vývojára a v každej úlohe CI. Binárka zostavená v `/home/anna/project` a tá istá zostavená v `/builds/job-4711/project` sú dva rôzne súbory.

### Tri zmeny

**1. Odstráňte hodiny.** Makrá `__DATE__` a `__TIME__` nemajú miesto vo firmvéri, ktorý má byť reprodukovateľný. Kompilátor to dokáže vynútiť, takže ich nikto omylom nepridá späť:

```text
BuildInfo.c:5:26: error: macro "__DATE__" might prevent reproducible builds [-Werror=date-time]
BuildInfo.c:5:39: error: macro "__TIME__" might prevent reproducible builds [-Werror=date-time]
```

**2. Verzia je vstup.** Ak chcete vedieť „čo je tento firmvér“, build dostane odpoveď zvonka: verziu, tag alebo hash commitu, ktoré build systém odovzdá ako definíciu. Ten istý zdroják má rovnakú verziu, teda rovnaké bajty:

```c
#ifndef BUILD_VERSION
#define BUILD_VERSION "unknown"
#endif

const char buildVersion[] = BUILD_VERSION;
```

**3. Odstráňte cesty.** Voľba `-ffile-prefix-map=OLD=NEW` nahradí prefix každej cesty, ktorú GCC vkladá do výstupu (`__FILE__`, ladiace informácie, aserty). Zdrojový priečinok projektu sa nahradí bodkou:

```cmake title="CMakeLists.txt (a part)"
# The version of the firmware is an input of the build, not the time of the build.
set(FIRMWARE_VERSION "1.2.3" CACHE STRING "Version of the firmware")
add_compile_definitions(BUILD_VERSION="${FIRMWARE_VERSION}")

# No clock in the binary, and no path of this PC in it.
add_compile_options(${MCU_FLAGS} ${WARNING_FLAGS} ${BUILD_OPTIONS}
                    -Wdate-time -Werror=date-time
                    -ffile-prefix-map=${CMAKE_SOURCE_DIR}=.)
```

S týmito tromi zmenami dá rovnaká kontrola:

```text
first : 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
second: 1bedc9d2b1d78452a77fa3440851d5ed3d9f6568d96edd4c4a18be3b828dc313
REPRODUCIBLE
```

`.bin` je identický a rovnako aj `.elf`, vo vydaní (`-Os -g0`) aj v debug builde (`-Og -g3`), ktorého ladiace informácie sú plné ciest. S `-ffile-prefix-map` ukáže `strings` binárky `./Application/BuildInfo.c` a verziu `1.2.3` a nič o PC, ktoré ju zostavilo.

## Test, ktorý nikdy nezostarne

Nestačí urobiť build reprodukovateľným raz, pretože prvé `__TIME__`, ktoré niekto pridá, ho zničí. Urobte z toho preto **test**: zostavte zdroják dvakrát a porovnajte. Toto je skript, ktorý som použil na čísla vyššie; skopíruje projekt do dvoch priečinkov, oba zostaví s pauzou medzi nimi a porovná SHA-256:

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

Spúšťaný v CI pri každom merge je strážcom. Použil som ho aj na pokazenú verziu informácií o builde, aby som si bol istý, že dokáže zlyhať, a zlyhal (`NOT REPRODUCIBLE`, návratový kód 1, dva rôzne hashe). Test, ktorý nikdy nezlyhal, je test, ktorý nepoznáte.

## Čo ešte rozbíja reprodukovateľný build

Otestoval som tri veci vyššie. Nasledujúce sú ďalšie známe zdroje problémov, na ktoré treba pamätať (v príklade som ich nepotreboval, takže ich len pomenúvam):

- **Poradie súborov**, ktoré pochádza z `file(GLOB ...)` alebo z výpisu adresára. Zdroje by sa mali uvádzať explicitne, ako v súboroch CMake modulov platformy.
- **Časová pečiatka v archíve** (statická knižnica vytvorená cez `ar`). Moderné verzie nástrojov majú deterministický režim, ale starý toolchain ho mať nemusí.
- **Generovaný kód.** Mocky a runnery unit testov alebo linker script generovaný pre MCU sa musia generovať rovnako z rovnakých vstupov. Pravidlami sú triedenie a žiadne časové pečiatky vo výstupe.
- **Samotný kompilátor.** Tá istá verzia toho istého kompilátora z dvoch zdrojov (balík distribúcie a archív od výrobcu) sa môže líšiť v knižniciach, ktoré linkuje. To je dôvod, prečo brať kompilátor z jedného miesta, čo je celý zmysel artefaktov.
- **Build s iným počtom vlákien.** Správny build systém dá rovnaký výsledok s `-j1` aj `-j16` a test na to je lacným doplnkom k tomu vyššie.

## Kontrolný zoznam

1. Každý nástroj je v `ArtifactsConfig.txt` pripnutý na presnú verziu. Žiadne `latest` vo vydaní.
2. Submoduly (BSP, platforma) sú pripnuté commitmi a aktualizácia je viditeľný commit.
3. Nič vo firmvéri nezávisí od času ani cesty: `-Werror=date-time`, `-ffile-prefix-map`.
4. Verzia je parametrom buildu, odvodená z tagu, a je uložená vo firmvéri.
5. CI zostavuje dvakrát a porovnáva. Občas tiež zostavuje offline, z cache.
6. Dodaná binárka sa ukladá spolu so svojím SHA-256 a tagom, takže „je to ten istý súbor“ má odpoveď bez nového buildu.

Odmenou je veta, ktorú použijete do telefónu so zákazníkom: *„Zostavil som presne váš firmvér a chyba v ňom (nie) je.“*

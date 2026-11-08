# Roadmapa

Checklist funkcií projektu — čo je hotové a čo čaká. Bez dátumov (históriu drží git). Súbor je verejný — žiadne interné dohody. Detail rozpracovaných vecí je v CURRENT.md, zadanie v SPEC.md.

## Overenie pred kódom

- [x] Prepnutie okna cez `vscode.openFolder` aktivuje existujúce okno s priečinkom a nenahradí aktuálne
- [x] Prepnutie cez API VS Code bez shellu, záložný CLI netreba
- [x] Odznak na ikone v Activity Bar a farebné ikony stavu vo VS Code 1.145

## Zoznam sedení Claude Code

- [x] Čítanie registra `~/.claude/sessions` (len `interactive` a `bg`)
- [x] Filter živých procesov cez tasklist s cache
- [x] Stavy čaká, beží, nečinné a dôvod čakania
- [x] Text riadku s trvaním a poradie podľa stavu

## Vlákna Codexu

- [x] Čítanie rollout JSONL za dnešok a včerajšok s cache podľa veľkosti a času zmeny
- [x] Čakanie na schválenie z markerov hooku
- [x] Čakanie na otázku z JSONL
- [x] Sloty na priečinok a pre desktopovú appku
- [x] Veľké súbory bez Pythonu (začiatok a koniec súboru)

## Zobrazenie

- [x] Ikona v Activity Bar a zoznam v ľavom paneli
- [x] Ikony a farby stavu, trvanie v popise, cesta v tooltipe
- [x] Hlavička s počtami a časom posledného čítania
- [x] Odznak s počtom čakajúcich
- [x] Značka sedení aktuálneho okna
- [x] Správy pre chýbajúci register a neznámy formát

## Akcie

- [x] Klik na riadok prepne do okna sedenia
- [x] Hlásenie pri zlyhanom prepnutí
- [x] Otvorenie konkrétneho chatu natívnej appky Codexu

## Upozornenia

- [x] Upozornenie pri prechode do čakania (Claude aj Codex)
- [x] Upozornenie pri dokončení ťahu Codexu
- [x] Bez upozornenia za sedenia vlastného okna

## Kvalita a balenie

- [x] Testy čistých funkcií prenesené z modu
- [x] Výstupný kanál s chybami čítania
- [x] Balík `.vsix` a lokálna inštalácia

## Prechod z modu

- [x] Prenos logiky overený testami a živým čítaním Claude aj Codexu
- [x] Používateľ potvrdil vzhľad a správanie panela v bežnom okne
- [x] Mod vypnutý a zálohovaný

## Neskôr

- [ ] Jedno čítanie pre všetky okná namiesto čítania v každom okne
- [ ] Vlákna Codexu staršie ako dva dni, ak stále bežia
- [ ] Inkrementálne čítanie JSONL od posledného miesta
- [ ] Lokálny HTML panel mimo VS Code, ktorý sleduje všetky sedenia a agentov naraz — len sledovanie, riadenie ostáva vo VS Code (nápad, nerozhodnuté)

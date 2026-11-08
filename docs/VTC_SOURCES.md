# Источники ВТХ и оговорки

В библиотеку встроены серии, которые подтвердил заказчик:

| Бренд | Серия | Тип | Диапазон In | Кривые / уставки | Icu, кА | Источник |
|---|---|---|---|---|---|---|
| IEK | ВА47-29 | MCB | 6–63 А | B, C, D | 4,5 | [iek.ru](https://www.iek.ru/products/catalog/modulnoe_oborudovanie/modulnoe_oborudovanie_karat/modulnye_avtomaticheskie_vyklyuchateli_karat/modulnye_avtomaticheskie_vyklyuchateli_va47_29) |
| IEK | ВА47-100 | MCCB | 16–100 А | TMD (10×In) | 6 | [iek.ru](https://www.iek.ru/products/catalog/modulnoe_oborudovanie/modulnoe_oborudovanie_karat/modulnye_avtomaticheskie_vyklyuchateli_karat/modulnye_avtomaticheskie_vyklyuchateli_va47_100) |
| CHINT | NB1-63 | MCB | 6–63 А | B, C, D | 6 | [chintglobal.com PDF](https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/final-power-distribution/mcb/nb1-63/catalog/NB1-63-MCB-Catalog.pdf) |
| CHINT | NM1-250 | MCCB | 100–250 А | TMD (10×In) | 35 | [chintglobal.mx PDF](https://chintglobal.mx/catalogos/NM1.pdf) |
| ABB | S200 | MCB | 6–63 А | B, C, D, K, Z | 6 | [ABB library](https://search.abb.com/library/Download.aspx?DocumentID=9AKK108472A1994&LanguageCode=en&DocumentPartId=&Action=Launch) |
| ABB | Tmax XT | MCCB | 16–250 А | TMD (10×In), TMA (5–10×In) | 36 | [ABB library](https://library.e.abb.com/public/3c630a4c4dfa4e368f515c2b71aae874/1SDC210100D0206_Tmax%20XT_Katalog%20wylacznikow_2024_09.pdf) |

## Что именно построено

- **MCB**: тепловая зона по IEC 60898-1 (1,13·In — не срабатывает за 1 ч; 1,45·In — срабатывает; 2,55·In — 1–60/120 с) и каталожная магнитная отсечка B/C/D/K/Z.
- **MCCB**: тепловая зона 1,05/1,3·In и каталожная уставка TMD/TMA.
- **График**: лог-лог, выбранная серия/кривая, точка пуска, кабель (адиабатическая стойкость), вышестоящая защита, проверка селективности.

## Важно

Это **не оцифрованные заводские кривые с точностью до пикселя**, а стандартные зоны IEC и каталожные кратности/уставки. Для согласования с производителем или экспертизы используйте официальный PDF серии. Данные приведены для инженерной проверки, а не для замены заводской документации.

Названия IEK, CHINT, ABB принадлежат их владельцам. Данные используются с указанием источников; при публикации в MIT-репозитории ответственность за условия использования несёт владелец репозитория.

# Spreadsheets glossary

The words the module uses, the same in its texts (English and German), its code and its docs.

| English | German | Means | Not |
| --- | --- | --- | --- |
| Spreadsheet | Tabelle | One file in the module's list (one store document), picked in the toolbar. | "sheet", "workbook", "Mappe" |
| Sheet | Blatt | One page inside a spreadsheet, shown as a tab at the bottom. "Tab" is only its button. | "spreadsheet", "Tabellenblatt" in texts |
| Cell | Zelle | One box of a sheet, named by column and row (`B2`). | |
| Row | Zeile | A line of cells across, numbered from 1. | |
| Column | Spalte | A line of cells down, lettered A, B … Z, AA. | |
| Range | Bereich | A block of cells, corner to corner (`B2:D9`). | "selection" when it is saved (the live view's range) |
| Formula | Formel | What a cell holds when it starts with `=`; worked out into its value. Function names stay English in German too. | |
| Reference | Bezug | A formula pointing at a cell or range, maybe on another sheet (`Gear!D7`, `'Boss runs'!B2:B40`). `$` keeps a part fixed when it is copied. | "link" (that is a format) |
| Format | Format | What a range shows and accepts: Automatic, Number, Percent, Text, Checkbox, Dropdown, Date, Link. | the looks (bold, colours), which are "look" in code (`styles`) |
| Live view | Live-Ansicht | The range a panel shows over the game, read-only, on a plate. | "overlay" for the range itself |

In code: `Sheet` is a sheet, `SpreadsheetData` a spreadsheet, `CellRange` / `GridRange` a range, `raw` a cell's stored form, `value` what it works out to, `shown` what the grid draws.

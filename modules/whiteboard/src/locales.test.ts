import { checkCatalogs } from "@tavora/official-ui/testing";
import { de, en } from "./locales";

// "connector.one" is the one-way arrow, not a plural form.
checkCatalogs(en, de, { notPlural: ["connector.one"] });

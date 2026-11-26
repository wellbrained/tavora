<script setup lang="ts">
import { Table, TableBody, TableCell, TableGroup, TableHead, TableHeader, TableNote, TableRow } from "@tavora/official-ui/components/ui/table";
import { t } from "../../i18n";
</script>

<template>
  <Table class="max-w-md">
    <TableHeader>
      <TableRow>
        <TableHead>{{ t("demo.table.stat") }}</TableHead>
        <TableHead align="end" numeric>{{ t("demo.table.before") }}</TableHead>
        <TableHead align="end" numeric>{{ t("demo.table.after") }}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableGroup :colspan="3">{{ t("demo.table.defence") }}</TableGroup>
      <TableRow tone="success">
        <TableHead scope="row" class="text-foreground text-sm font-normal">{{ t("demo.table.life") }}</TableHead>
        <TableCell align="end" numeric>1,180</TableCell>
        <TableCell align="end" numeric>1,240</TableCell>
      </TableRow>
      <TableRow marked>
        <TableHead scope="row" class="text-foreground text-sm font-normal">{{ t("demo.table.armour") }}</TableHead>
        <TableCell align="end" numeric>3,880</TableCell>
        <TableCell align="end" numeric>3,880</TableCell>
      </TableRow>
      <TableRow tone="destructive">
        <TableHead scope="row" class="text-foreground text-sm font-normal">{{ t("demo.table.evasion") }}</TableHead>
        <TableCell align="end" numeric>1,020</TableCell>
        <TableCell align="end" numeric>912</TableCell>
      </TableRow>
      <TableNote :colspan="3">{{ t("demo.table.note") }}</TableNote>
    </TableBody>
    <TableBody>
      <TableGroup :colspan="3">{{ t("demo.table.resistances") }}</TableGroup>
      <TableRow>
        <TableHead scope="row" class="text-foreground text-sm font-normal">{{ t("demo.table.fire") }}</TableHead>
        <TableCell align="end" numeric>75%</TableCell>
        <TableCell align="end" numeric>75%</TableCell>
      </TableRow>
      <TableRow tone="warning">
        <TableHead scope="row" class="text-foreground text-sm font-normal">{{ t("demo.table.cold") }}</TableHead>
        <TableCell align="end" numeric>75%</TableCell>
        <TableCell align="end" numeric>68%</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

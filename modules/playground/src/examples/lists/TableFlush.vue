<script setup lang="ts">
import { Table, TableBody, TableCell, TableGroup, TableHead, TableHeader, TableRow } from "@tavora/official-ui/components/ui/table";
</script>

<template>
  <div class="flex w-full max-w-md flex-col gap-1">
    <h4 class="text-sm font-semibold">Defences</h4>
    <Table flush>
      <TableHeader>
        <TableRow>
          <TableHead>Stat</TableHead>
          <TableHead align="end" numeric>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableGroup :colspan="2">Pools</TableGroup>
        <TableRow>
          <TableCell>Life</TableCell>
          <TableCell align="end" numeric>2,810</TableCell>
        </TableRow>
        <TableRow marked>
          <TableCell>Energy Shield</TableCell>
          <TableCell align="end" numeric>3,420</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>

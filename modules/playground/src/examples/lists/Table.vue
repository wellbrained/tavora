<script setup lang="ts">
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@tavora/official-ui/components/ui/table";
</script>

<template>
  <Table class="max-w-md">
    <TableCaption>Ingredients for 10 portions</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Item</TableHead>
        <TableHead>Where</TableHead>
        <TableHead class="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Flour</TableCell>
        <TableCell class="text-muted-foreground">Oven</TableCell>
        <TableCell class="text-right tabular-nums">10</TableCell>
      </TableRow>
      <TableRow data-state="selected">
        <TableCell>Mushrooms</TableCell>
        <TableCell class="text-muted-foreground">Forest</TableCell>
        <TableCell class="text-right tabular-nums">10</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Salt</TableCell>
        <TableCell class="text-muted-foreground">Shop</TableCell>
        <TableCell class="text-right tabular-nums">4</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

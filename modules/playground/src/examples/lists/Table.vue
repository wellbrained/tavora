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
        <TableHead align="end" numeric>Amount</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Flour</TableCell>
        <TableCell class="text-muted-foreground">Oven</TableCell>
        <TableCell align="end" numeric>10</TableCell>
      </TableRow>
      <TableRow selected>
        <TableCell>Mushrooms</TableCell>
        <TableCell class="text-muted-foreground">Forest</TableCell>
        <TableCell align="end" numeric>10</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Salt</TableCell>
        <TableCell class="text-muted-foreground">Shop</TableCell>
        <TableCell align="end" numeric>4</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

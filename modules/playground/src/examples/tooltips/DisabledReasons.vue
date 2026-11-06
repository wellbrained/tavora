<script setup lang="ts">
import { MoreHorizontal, Pin } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { useId } from "vue";

const id = useId();
</script>

<template>
  <div class="flex max-w-sm flex-col gap-4">
    <SwitchField :model-value="true" label="Share my status" disabled disabled-reason="Your admin turned this on." />
    <div class="flex items-center gap-2">
      <Checkbox :id="`${id}-remember`" disabled disabled-reason="Sign in first." />
      <Label :for="`${id}-remember`">Remember me</Label>
    </div>
    <Input model-value="Waystone" disabled disabled-reason="Only the owner can rename this." aria-label="Name" />
    <Select model-value="en" disabled disabled-reason="Your admin picks the language.">
      <SelectTrigger class="w-56" aria-label="Language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="de">Deutsch</SelectItem>
      </SelectContent>
    </Select>
    <div class="flex items-center gap-2">
      <Button disabled disabled-reason="Add a name and an icon first.">Publish</Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="secondary"><MoreHorizontal :stroke-width="1.5" /> Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-48">
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem disabled disabled-reason="Already pinned."><Pin /> Pin</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

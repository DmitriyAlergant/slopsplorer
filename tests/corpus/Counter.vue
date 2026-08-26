<!-- A single-file component mixes markup, script, and style. -->
<template>
  <button @click="count += 1">{{ count }}</button>
</template>

<script setup>
// Reactive state.
import { ref } from "vue";

/* Start at zero. */
const count = ref(0);
</script>

<style scoped>
button {
  color: #1d4ed8; /* brand */
}
</style>

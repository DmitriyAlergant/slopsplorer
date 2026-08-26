<!-- Svelte component for the corpus. -->
<script>
  // Reactive state.
  let count = 0;

  /* Increment on click. */
  function increment() {
    count += 1;
  }
</script>

<button on:click={increment}>{count}</button>

<style>
  button {
    color: #1d4ed8;
  }
</style>

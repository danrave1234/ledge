<script lang="ts">
  let { name, size = 17 }: { name: string; size?: number } = $props();

  const P: Record<string, string> = {
    spark:
      '<path d="M12 3l1.7 4.8L18 9.5l-4.3 1.7L12 16l-1.7-4.8L6 9.5l4.3-1.7z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    history:
      '<path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4"/><path d="M3.2 4.3v4h4"/><path d="M12 7.5v5l3 1.8"/>',
    settings:
      '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.1"/><circle cx="15" cy="12" r="2.1"/><circle cx="8" cy="17" r="2.1"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    send: '<path d="M12 19V6"/><path d="M6 12l6-6 6 6"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.8 5.7 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/>',
    screen:
      '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7"/><path d="M12 16.5V20"/>',
    clip: '<path d="M20 11.5l-7.6 7.6a4.2 4.2 0 0 1-6-6l7.7-7.7a2.6 2.6 0 0 1 3.7 3.7L10.3 16.6"/>',
    mic: '<rect x="9.2" y="3" width="5.6" height="10.5" rx="2.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="17.5" x2="12" y2="21"/>',
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash:
      '<path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6.5 7l1 12.5a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9L18 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L20 6.5"/>',
    back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    edit: '<path d="M4 20h4L20.5 7.5a2.5 2.5 0 0 0-3.5-3.5L4 16.5V20z"/><line x1="14.5" y1="6.5" x2="18" y2="10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    pin: '<path d="M9 3.5h6l-1 6 3.5 2.7v1.8H6.5v-1.8L10 9.5z"/><line x1="12" y1="14" x2="12" y2="20.5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2.2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    refresh:
      '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 3.5V8h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20.5V16h4.5"/>',
    stack:
      '<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M3.5 12L12 16.5 20.5 12"/><path d="M3.5 16L12 20.5 20.5 16"/>',
    folder:
      '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2.5l1.5 2h8A1.5 1.5 0 0 1 18 9.5v8A1.5 1.5 0 0 1 16.5 19h-13A1.5 1.5 0 0 1 2 17.5v-10A1.5 1.5 0 0 1 3.5 6L3 7.5z"/>',
    file: '<path d="M14 2.5H5.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8.5z"/><path d="M14 2.5v6h6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M13.5 9.5l2 2"/>',
    database:
      '<ellipse cx="12" cy="5.5" rx="7.2" ry="2.8"/><path d="M4.8 5.5v6c0 1.55 3.2 2.8 7.2 2.8s7.2-1.25 7.2-2.8v-6"/><path d="M4.8 11.5v6c0 1.55 3.2 2.8 7.2 2.8s7.2-1.25 7.2-2.8v-6"/>',
    download:
      '<path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
    sparkles: '<path d="M12 3l1.7 4.8L18 9.5l-4.3 1.7L12 16l-1.7-4.8L6 9.5l4.3-1.7z"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
    power: '<path d="M12 3.5v8"/><path d="M7.3 6.7a7 7 0 1 0 9.4 0"/>',
    music:
      '<path d="M9 17.5V5.5l10-2v12"/><ellipse cx="6.5" cy="17.5" rx="2.5" ry="2"/><ellipse cx="16.5" cy="15.5" rx="2.5" ry="2"/>',
    play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
    pause:
      '<rect x="8" y="5.5" width="3" height="13" rx="1.2"/><rect x="13" y="5.5" width="3" height="13" rx="1.2"/>',
    next: '<path d="M6.5 6l7.5 6-7.5 6z"/><path d="M17.5 6v12"/>',
    previous: '<path d="M17.5 6L10 12l7.5 6z"/><path d="M6.5 6v12"/>',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <!-- Safe: `P` is a hardcoded table of SVG path data in this file and `name`
       only selects from it. No user, model, or network content reaches here. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html P[name] ?? ""}
</svg>

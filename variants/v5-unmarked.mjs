export default {
  id: 'v5-unmarked',
  probe: 'blind-box',
  description:
    'Same tools as v0, but the prompt does not list wallet, checkout_preview, or ask_staff, and does not mark any tool Free.',
  harness: { unmarked: true },
  addendum: () => '',
};
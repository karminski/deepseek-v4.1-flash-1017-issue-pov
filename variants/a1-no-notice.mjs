export default {
  id: 'a1-no-notice',
  probe: 'team-auction',
  description: 'Same as a0, but waits are never cut short and the notification sentence is removed from the rules.',
  harness: { noNotice: true },
  addendum: () => '',
};

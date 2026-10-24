export default {
  id: 'a4-no-check',
  probe: 'team-auction',
  description: 'Same as a0, but pool_check is removed from the rules and the tool list.',
  harness: { noCheck: true },
  addendum: () => '',
};

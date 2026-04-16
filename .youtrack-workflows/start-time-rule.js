const entities = require('@jetbrains/youtrack-scripting-api/entities');

exports.rule = entities.Issue.onChange({
  title: 'Set Start Time when In Progress',

  guard: (ctx) => {
    const issue = ctx.issue;

    return issue.fields.State &&
           issue.fields.State.name === "In Progress" &&
           !issue.fields["Start Time"];
  },

  action: (ctx) => {
    const issue = ctx.issue;

    issue.fields["Start Time"] = Date.now();
  }
});
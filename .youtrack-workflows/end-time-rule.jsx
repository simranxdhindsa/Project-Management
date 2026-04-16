const entities = require('@jetbrains/youtrack-scripting-api/entities');

exports.rule = entities.Issue.onChange({
  title: 'Set End Time (final final)',

  guard: (ctx) => {
    const issue = ctx.issue;
    const state = issue.fields.State;

    if (!state) return false;

    const isDone =
      state.name === "Dev" ||
      state.name === "Ready for Stage" ||
      state.name === "Stage" ||
      state.name === "Ready For Prod" ||
      state.name === "Prod" ||
      state.name === "Mobile Done" ||
      state.name === "Verified" ||
      state.name === "Closed";

    return isDone &&
           issue.fields["Start Time"] &&
           !issue.fields["End Time"];
  },

  action: (ctx) => {
    const issue = ctx.issue;

    issue.fields["End Time"] = Date.now();
  }
});
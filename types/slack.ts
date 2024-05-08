import {
  FunctionDefinitionArgs,
  FunctionRuntimeParameters,
} from "deno-slack-sdk/functions/types.ts";

export type SlackFunctionOutputs<Definition> = Definition extends
  FunctionDefinitionArgs<infer I, infer O, infer RI, infer RO>
  ? FunctionRuntimeParameters<O, RO>
  : never;

export type SlackFunctionInputs<Definition> = Definition extends
  FunctionDefinitionArgs<infer I, infer O, infer RI, infer RO>
  ? FunctionRuntimeParameters<I, RI>
  : never;

export type PlainTextObject = {
  type: "plain_text";
  emoji?: boolean;
  text: string;
};
export type Option = {
  text: PlainTextObject;
  value: string;
};
export type OptionGroup = {
  label: PlainTextObject;
  options: Option[];
};
export type SuggestionResponse =
  | { options: Option[] }
  | { option_groups: OptionGroup[] };

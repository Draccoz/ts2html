declare namespace Polymer {
  export interface BaseClass extends HTMLElement {
    new (): BaseClass;
    is: string;
    $: any;
    register(): void;
  }

  export var Element: BaseClass;
}

declare namespace MathQuill {
  export interface EditableField {
    cmd(command: any): any;
    select(): any;
    latex(): any;
  }

  export function getInterface(version: number): any;
}

declare var component: (name: string) => any;
declare var property: (name: any) => any;
declare var listen: (name: any) => any;

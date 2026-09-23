sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("demo.v2.Component", {
    metadata: { manifest: "json" },
    load() {
      const model = this.getModel();
      model.read("/Orders", { success(data) { return data.results.filter(order => order.Open); } });
    }
  });
});

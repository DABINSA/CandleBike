
    const React = require('react');
    const reactUsePolyfill = require('/home/runner/work/CandleBike/CandleBike/toss-miniapp/node_modules/react18-use/dist/cjs/index.js');
    const reactEffectEventPolyfill = require('/home/runner/work/CandleBike/CandleBike/toss-miniapp/node_modules/use-effect-event/dist/index.cjs');
  
    function useOptimisticPolyfill(passthroughState, reducer) {
      const [optimisticState, setOptimisticState] = React.useState(passthroughState);
      const lastPassthroughState = React.useRef(passthroughState);
  
      if (passthroughState !== lastPassthroughState.current) {
        setOptimisticState(passthroughState);
        lastPassthroughState.current = passthroughState;
      }
  
      function addOptimistic(action) {
        setOptimisticState((current) => reducer(current, action));
      }
  
      return [optimisticState, addOptimistic];
    }
  
    module.exports = Object.assign(React, {
      use: reactUsePolyfill.use,
      useEffectEvent: reactEffectEventPolyfill.useEffectEvent,
      useOptimistic: useOptimisticPolyfill,
    });
    
;(function(root) {
  const noop = function() {};

  const isObject = function(val) {
    return val !== null && typeof val === 'object';
  };

  const isFn = function(fn) {
    return typeof fn === 'function';
  };

  const hasOwn = function(obj, key) {
    return obj.hasOwnProperty(key);
  };

  const warn = function(msg) {
    console.error(msg);
  };

  // 设置当前Dep.target对象，用于Watcher收集依赖
  const pushTarget = function(target) {
    Dep.target = target;
  };
  
  const popTarget = function() {
    Dep.target = null;
  };

  // 主要实现data与computed数据响应式
  const defineReactive = function(obj, key) {
    // 创建dep对象
    const dep = new Dep();
    let val = obj[key];
    Object.defineProperty(obj, key, {
      emumerable: true,
      configurable: true,
      get: function reactiveGetter() {
        // data中属性调用时会调用depend, 即收集依赖
        Dep.target && dep.depend();
        return val;
      },
      set: function reactiveSetter(newVal) {
        if (newVal === val) return;
        val = newVal;
        // 触发视图更新
        dep.notify();
      }
    });
  };

  // 默认的defineProperty描述符对象
  const sharedPropertyDefinition = {
    emumerable: true,
    configurable: true,
    set: noop,
    get: noop
  };

  // 代理data、methods中的属性到实例vm上，即支持this.属性形式
  const proxy = function(vm, source, key) {
    sharedPropertyDefinition.set = function(newVal) {
      vm[source][key] = newVal;
    };
    sharedPropertyDefinition.get = function() {
      return vm[source][key];
    };
    Object.defineProperty(vm, key, sharedPropertyDefinition);
  };

  // 初始化methods
  const initMethods = function(vm) {
    const { methods } = vm.$options;
    Object.keys(methods).forEach(key => {
      const fn = methods[key];
      if (isFn(fn)) vm[key] = fn;
    });
  };

  // 初始化data
  const initData = function(vm) {
    const keys = Object.keys(vm.$data);
    const methods = vm.$options.methods;
    let i = keys.length;
    while(i--) {
      var key = keys[i];
      if (methods && hasOwn(methods, key)) {
        warn(`methods ${key} has already been defined as a data property`);
      }
      // 将$data中属性代理到vm实例上
      proxy(vm, '$data', key);
    }
    new Observer(vm.$data);
  };

  // computed收集依赖
  const createComputedGetter = function(key) {
    return function computedGetter() {
      const watcher = this._computedWatchers && this._computedWatchers[key];
      if (watcher) {
        // 触发收集依赖
        watcher.depend();
        // 执行computed
        return watcher.evaluate();
      }
    }
  };

  /*
   * 使用Object.defineProperty来实现computed响应式以及依赖收集
   * 支持函数和对象两种形式
   */
  const defineComputed = function(vm, key, userDef) {
    if (isFn(userDef)) {
      sharedPropertyDefinition.get = createComputedGetter(key);
    } else {
      sharedPropertyDefinition.get = createComputedGetter(key);
      sharedPropertyDefinition.set = userDef.set || noop;
    }
    Object.defineProperty(vm, key, sharedPropertyDefinition);
  };

  // 初始化computed
  const initComputed = function(vm) {
    const { computed } = vm.$options;
    if (!isObject(computed)) return;
    const watchers = {};
    Object.keys(computed).forEach(key => {
      // 判断$data中是否存在同名的
      if (key in vm.$data) warn(`The computed property ${key} is already defined in data.`);
      // 获取具体computed，区分对象和函数两种形式
      const userDef = computed[key];
      const getter = typeof userDef === 'function' ? userDef : userDef.get;
      // 每一个computed对应一个Watcher实例对象
      watchers[key] = new Watcher(vm, getter || noop, true);
      if (!(key in vm)) defineComputed(vm, key, userDef);
    });
    vm._computedWatchers = watchers;
  };

  // 初始化data、computed、methods等
  const initState = function(vm) {
    const { $options } = vm || {};
    vm._watchers = [];
    hasOwn($options, 'methods') && initMethods(vm);
    hasOwn(vm, '$data')&& initData(vm);
    hasOwn($options, 'computed') && initComputed(vm);
  };

  // 虚拟元素节点创建
  const createElement = function(context, tag, data, children) {
    return new VNode(tag, data, children, undefined, context);
  };

  // 初始化render
  const initRender = function(vm) {
    vm._vnode = null;
    vm._c = function(a, b, c) { return createElement(vm, a, b, c);};
  };


  // _s函数的处理
  const toString = function(val) {
    return val ? typeof val === 'object' ? JSON.stringify(val) : String(val) : '';
  };

  // 虚拟文本节点创建
  const createTextVNode = function(text) {
    return new VNode(undefined, undefined, undefined, String(text));
  };

  // 加载过程中的render相关处理
  // target === MVVM.prototype
  const renderMixin = function(target) {
    target._s = toString;
    target._v = createTextVNode;
  };

  // 匹配开始标签
  const startTagRe = /^<\w*/;
  // 匹配开始标签结束
  const startTagCloseRe = /\s*(\/?)>/;
  // 匹配属性
  const attrRegExp = /([a-z-]+=\"\w*\"\s*)/i;
  // 匹配文本
  const textRegExp = /(\s*\{\{\s*\w*\s*\}\}\s*)/;
  // 匹配结束标签
  const endTagRe = /^<\/\w*>/i;
  // // 匹配{{ text }} 形式
  var defaultTagRE = /\{\{((?:.|\n)+?)\}\}/g;

  /**
   * 处理template为ast
   * @param {*} html 当前的template
   * parse的处理逻辑是：
   *  template为字符串，获取3种类型的字符串：标签、属性、文本
   */
  const parse = function(html) {
    let index = 0;
    // ast结构对象
    let root = null;
    let currentParent = null;
    // 处理当前位置以及截取template字符串
    const advance = function (step) {
      index += step;
      html = html.substring(step);
    };

    while (html) {
      var textEnd = html.indexOf('<');
      if (textEnd === 0) {
        // 处理结束标签
        var endTagMatch = html.match(endTagRe);
        if (endTagMatch) {
          advance(endTagMatch[0].length);
          continue;
        }
  
        // 匹配开始标签
        const tagMatchRes = html.match(startTagRe);
        if (tagMatchRes) {
          const targetTag = tagMatchRes[0];
          const tagName = targetTag.slice(1);
          advance(targetTag.length);
          // 匹配属性
          const attrs = [];
          const attrMatchRes = [...new Set(html.match(attrRegExp))];
          attrMatchRes.forEach(attr => {
            advance(attr.length);
            const item = {};
            const attrParts = attr.split('=');
            item.key = attrParts[0];
            item.value = attrParts[1].replace(/\"|\"/g, '');
            attrs.push(item);
          });
          // 处理开始标签的结束处
          const startTagCloseRes = html.match(startTagCloseRe);
          if (startTagCloseRes) advance(startTagCloseRes[0].length);

          currentParent = {
            type: 1,
            tag: tagName.trim(),
            attrs,
            children: [],
            parent: currentParent
          };
          // 处理存在子节点情况
          if (!root) {
            root = currentParent;
          } else {
            root.children.push(currentParent);
          }
          continue;
        }
      }
  
      if (textEnd >= 0) {
        let next = null;
        let text = null;
        const rest = html.slice(textEnd);
        // 处理开始标签之后子节点的问题
        while (!endTagRe.test(rest) && !startTagRe.test(rest)) {
          next = rest.indexOf('<', 1);
          if (next < 0) { break }
          textEnd += next;
          rest = html.slice(textEnd);
        }
        // 获取当前标签下的文本
        text = html.substring(0, textEnd);
        advance(textEnd);
        if (currentParent && text) {
          const children = currentParent.children;
          // 匹配 {{ text }}形式字符串
          const textMatchRes = [...new Set(text.match(textRegExp))];
          if (textMatchRes) {
            textMatchRes.forEach(item => {
              // 处理空格和换行的格式，保留文本形式空白字符原样
              let text = item.match(defaultTagRE)[0];
              const textLen = text.length;
              const index = item.indexOf(text);
              // 处理{{ text }}为 _s(text)
              text = text.replace(/\{\{/g, '_s(');
              text = text.replace(/\}\}/g, ')');
              // 保留所有文本区域的换行和空格
              tokens = [
                JSON.stringify(item.substring(0, index)), 
                text, 
                JSON.stringify(item.substring(index + textLen))
              ];
              children.push({
                type: 3,
                text: text.replace(/_s\(\s*|\s*\)/g, ''),
                expression: tokens.join('+'),
                tokens,
                isBind: true
              });
            });
          }
        }
      }
    }
    return root;
  };

  /**
   *  处理标签属性成指定形式：{ attrs: { key: value }}
   */
  const genProps = function(el) {
    const data = {};
    if (el.attrs) {
      const { attrs } = el;
      const attrsMap = {};
      attrs.forEach(({key, value}) => {
        attrsMap[key] = value;
      });
      data.attrs = attrsMap;
    }
    return JSON.stringify(data);
  };

  // 处理子节点
  const genChildren = function(children) {
    if (Array.isArray(children) && children) {
      return children.map(child => {
        // 递归处理
        return generate(child);
      });
    }
  };

  // 构建render函数
  const generate = function(ast) {
    let code = null;
    let { type } = ast;
    // 处理标签属性
    const attrs = genProps(ast);
    // 处理子节点
    const children = genChildren(ast.children);
    // 处理标签，构建成Vue中render的形式，createElement('div ,{attrs: {}}, [子节点])
    if (type === 1 && ast.tag) {
      code = `_c('${ast.tag}', ${attrs}, [${children}])`;
    }
    // 文本处理，目前只支持变量的直接调用，不支持表达式形式（即 {{ ？ ： }}）
    if (type === 3) {
      code = `_v(${ast.expression})`;
    }
    return code;
  };

  // 编译template返回render函数
  const compile = function(template) {
    const ast = parse(template);
    const code = generate(ast);
    return new Function(`with(this){return ${code}}`);
  };

  // 添加节点
  const insert = function(parent, child, refElm) {
    // 判断挂载点是否存在兄弟节点，保证替换位置不变
    if (refElm && refElm.parentNode === parent) {
      parent.insertBefore(child, refElm);
    } else {
      parent.appendChild(child);
    }
  };

  // 添加属性到新DOM节点上
  const insertAttrs = function(node, data) {
    if (!node) return;
    const attrs = Object.keys(data);
    attrs.forEach(key => {
      node.setAttribute(key, data[key]);
    });
  };

  // 构建和替换DOM
  const createElm = function(vnode, parentElm, refElm) {
    const { tag, data, children, text } = vnode || {};
    if (tag) {
      // 创建标签DOM
      const node = document.createElement(tag);
      if (data.hasOwnProperty('attrs')) insertAttrs(node, data.attrs);
      vnode.elm = node;
      // 处理子节点
      if (Array.isArray(children) && children.length) {
        children.forEach(item => createElm(item, vnode.elm));
      }
      insert(parentElm, vnode.elm, refElm);
    } else if (text) {
      // 文本节点处理
      vnode.elm = document.createTextNode(text);
      insert(parentElm, vnode.elm);
    }
  };

  // 移除旧的DOM节点
  const removeVnodes = function(parent, children) {
    children.forEach(item => {
      parent.removeChild(item.elm);
    });
  };

  let uid = 0;
  const MVVM = function(options) {
    this._init(options);
  };

  // 实际上是注册_s、_v全局实例方法
  renderMixin(MVVM.prototype);

  MVVM.prototype._init = function(options) {
    this._uid = uid++;
    this.$options = options || {};
    this.$el = document.querySelector(options.el) || null;
    this.$data = options.data || {};
    initRender(this);
    initState(this);
    if (this.$el) {
      // 挂载
      this.$mount();
    }
  };

  // 执行render函数生成vnode
  MVVM.prototype._render = function() {
    const render = this.$render;
    return render ? render.call(this) : null;
  };

  // 比较DOM并替换
  MVVM.prototype._patch = function(oldVnode, vnode) {
    // 是否是真实DOM
    if (oldVnode.nodeType) {
      oldVnode = new VNode(oldVnode.tagName.toLowerCase(), {}, [], undefined, undefined, oldVnode);
    }
    const parentElm = oldVnode.elm.parentNode;
    // 根据vnode生成真实DOM
    createElm(vnode, parentElm, oldVnode.elm.nextSibling);
    // 移除旧的DOM
    parentElm && removeVnodes(parentElm, [oldVnode]);
  };

  // 根据vnode生成最新DOM并替换
  MVVM.prototype._update = function(vnode) {
    const vm = this;
    var prevNode = vm._vnode;
    vm._vnode = vnode;
    vm.$el = prevNode ? vm._patch(prevNode, vnode) : vm._patch(vm.$el, vnode);
  };

  // 挂载
  MVVM.prototype.$mount = function() {
    this.$template = this.$el.outerHTML;
    this.$render = compile(this.$template.trim());
    var updateComponent = function() {
      return this._update(this._render());
    };
    new Watcher(this, updateComponent);
  };

  /*
    观察者对象
  */
  const Observer = function(value) {
    this.value = value || {};
    this.walk();
  };

  // 调用defineReactive实现data响应式
  Observer.prototype.walk = function() {
    const data = this.value;
    Object.keys(data).forEach(item => {
      defineReactive(data, item);
    });
  };

  /**
   * 依赖对象
   * @param id 唯一标识
   * @param subs Watcher对象集合 
   */
  var uid$1 = 0;
  const Dep = function() {
    this.id = uid$1++;
    this.subs = [];
  };

  // 添加依赖
  Dep.prototype.addSub = function(watcher) {
    this.subs.push(watcher);
  };

  Dep.prototype.depend = function() {
    Dep.target && Dep.target.addDep(this);
  };

  // 通知视图更新
  Dep.prototype.notify = function() {
    const subs = this.subs.slice();
    subs.forEach(watcher => watcher.update());
  };

  // 用于指定当前Dep对应的对象，即Watcher对象
  Dep.target = null;

  /**
   * 监听器对象
   * @param {*} vm MVVM实例
   * @param {*} getter getter函数
   */
  const Watcher = function(vm, getter, computed) {
    this.vm = vm;
    vm._watchers.push(this);
    // 区分是否是计算属性
    this.computed = !!computed;
    this.dirty = this.computed;
    // 依赖集合
    this.deps = [];
    this.depIds = [];
    this.getter = getter || noop;
    if (this.computed) {
      this.value = null;
      this.dep = new Dep;
    } else {
      this.value = this.get();
    }
  };

  // 执行getter
  Watcher.prototype.get = function() {
    pushTarget(this);
    const value = this.getter.call(this.vm);
    popTarget();
    return value;
  };

  Watcher.prototype.addDep = function(dep) {
    const id = dep.id;
    if (!this.depIds.includes(id)) {
      this.depIds.push(id);
      this.deps.push(dep);
      dep.addSub(this);
    }
  };

  Watcher.prototype.depend = function() {
    if (this.dep && Dep.target) this.dep.depend();
  };

  // computed getter时调用获取value
  Watcher.prototype.evaluate = function() {
    if (this.dirty) {
      this.value = this.get();
      this.dirty = false;
    }
    return this.value;
  }

  /**
   * 依赖发生变化会通知视图更新，而此处就是实现的关键
   * 本MVVM实现直接调用了get方法来实现的（暂未研究Vue此处实现）
   */
  Watcher.prototype.update = function() {
    if (this.computed) {
      this.dirty = true;
    } else {
      this.value = this.get();
    }
  };

  /**
   * 虚拟DOM
   * @param {*} tag 标签名称
   * @param {*} data 标签属性等
   * @param {*} children 子节点
   * @param {*} text 文本
   * @param {*} context 上下文环境对象，即MVVM实例对象
   */
  const VNode = function(tag, data, children, text, context, elm) {
    this.tag = tag;
    this.data = data;
    this.children = children;
    this.text = text;
    this.context = context;
    this.elm = elm;
  };

  root.MVVM = MVVM;
})(window);
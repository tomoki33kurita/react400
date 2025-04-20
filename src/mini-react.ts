// 抽象クラス
abstract class Component {
  props: Record<string, unknown>
  abstract state: unknown
  abstract setState: (value: unknown) => void
  abstract render: () => VirtualElement

  constructor(props: Record<string, unknown>) {
    this.props = props
  }

  static REACT_COMPONENT = true
}

interface ComponentFunction {
  new (props: Record<string, unknown>): Component
  (props: Record<string, unknown>): VirtualElement | string
}

type VirtualElementType = ComponentFunction | string

interface VirtualElementProps {
  children?: VirtualElement[]
  [propName: string]: unknown
}

interface VirtualElement {
  type: VirtualElementType
  props: VirtualElementProps
}

type FiberNodeDom = Element | Text | null | undefined
interface FiberNode<S = any> extends VirtualElement {
  alternate: FiberNode | null
  dom?: FiberNodeDom
  effectTag?: string
  child?: FiberNode
  return?: FiberNode
  sibling?: FiberNode
  hooks?: {
    state: S
    queue: S[]
  }[]
}

let wipRoot: FiberNode | null = null
let nextUnitOfWork: FiberNode | null = null
let currentRoot: FiberNode | null = null
let deletions: FiberNode[] = []
let wipFiber: FiberNode
let hookIndex = 0

// React.Fragmentをサポート
const Fragment = Symbol.for("react.fragment")

// 形式は即時実行関数(IIFE)で、最後に(window)を書くことで、直前の関数の引数にwindowを渡し、即時実行している
;((global: Window) => {
  const id = 1
  const fps = 1e3 / 60
  let frameDeadline: number = 0
  let pendingCallback: IdleRequestCallback = () => {}
  const channel = new MessageChannel()
  const timeRemaining = () => frameDeadline - window.performance.now()

  const deadline = {
    didTimeout: false,
    timeRemaining,
  }

  channel.port2.onmessage = () => {
    if (typeof pendingCallback === "function") {
      pendingCallback(deadline)
    }
  }

  global.requestIdleCallback = (callback: IdleRequestCallback) => {
    global.requestAnimationFrame((frameTime) => {
      frameDeadline = frameTime + fps
      pendingCallback = callback
      channel.port1.postMessage(null)
    })
    return id
  }
})(window)

// 引数がVirtualElementかどうかを判定する関数
const isVirtualElement = (e: unknown): e is VirtualElement => {
  return typeof e === "object"
}

// type:"TEXT"の要素となるobjectを作成する関数
const createTextElement = (text: string): VirtualElement => ({
  type: "TEXT",
  props: {
    nodeValue: text,
  },
})

// childを引数で受け取り、
// typeとpropsを持つobject(-> VirtualElement)を作成し、配列に詰め直し、
// それをpropsに持つVirtualElementを返す関数
const createElement = (
  type: VirtualElementType,
  props: Record<string, unknown> = {},
  ...child: (unknown | VirtualElement)[]
): VirtualElement => {
  const children = child.map((c) => {
    return isVirtualElement(c) ? c : createTextElement(String(c))
  })

  return {
    type,
    props: {
      ...props,
      children,
    },
  }
}

// DOMを更新する関数
const updateDOM = (DOM, prevProps, nextProps) => {
  const defaultPropKeys = "children"

  // prevPropsをループして、removeEventListenerを実行
  for (const [removePropKey, removePropValue] of Object.entries(prevProps)) {
    // keyが"on"で始まる場合はremoveEventListenerを実行
    // とにかく、removePropKeyが"on"で始まる場合はremoveEventListenerを実行する
    if (removePropKey.startsWith("on")) {
      DOM.removeEventListener(
        removePropKey.substr(2).toLowerCase(),
        removePropValue
      )
    }
    // removePropKeyがdefaultPropKeysでない場合は、DOMのプロパティを空にする
    if (removePropKey !== defaultPropKeys) {
      DOM[removePropKey] = ""
    }
  }

  // nextPropsをループして、addEventListenerを実行
  for (const [addPropKey, addPropValue] of Object.entries(nextProps)) {
    // keyが"on"で始まる場合はaddEventListenerを実行
    if (addPropKey.startsWith("on")) {
      DOM.addEventListener(addPropKey.substr(2).toLowerCase(), addPropValue)
    }
    // addPropKeyがdefaultPropKeysでない場合は、DOMのプロパティを更新する
    if (addPropKey !== defaultPropKeys) {
      DOM[addPropKey] = addPropValue
    }
  }
}

// fiberNodeを受け取り、
// typeとpropsを持つDOMを作成する関数
// DOMが存在したら、そのプロパティも更新して、
// 最終的にDOMを返す関数
const createDOM = (fiberNode) => {
  const { type, props } = fiberNode
  let DOM: HTMLElement | Text | null = null

  // typeが"TEXT"の場合はTextNodeを作成する
  if (type === "TEXT") {
    DOM = document.createTextNode("")
  }
  // typeが"TEXT"でない場合は、DOMを作成する
  // typeがstringの場合は、createElementを実行する
  if (typeof type === "string") {
    DOM = document.createElement(type)
  }
  // ここまでで、DOMが存在したら、更新処理を実行する
  if (DOM !== null) {
    // DOMのプロパティを更新している
    updateDOM(DOM, {}, props)
  }

  return DOM
}

const isDef = <T>(param: T): param is NonNullable<T> => {
  return param !== void 0 && param !== null
}

const isPlainObject = (val: unknown): val is Record<string, unknown> => {
  return (
    Object.prototype.toString.call(val) === "[object Object]" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(val))
  )
}

// Change the DOM based on fiber node changes.
// Note that we must complete the comparison of all fiber nodes before commitRoot.
// The comparison of fiber nodes can be interrupted, but the commitRoot cannot be interrupted.
// Reactのコミットフェーズの役割
const commitRoot = () => {
  // 親fiberを見つける、定義づける関数
  const findParentFiber = (fiberNode?: FiberNode) => {
    if (fiberNode) {
      let parentFiber = fiberNode.return
      while (parentFiber && !parentFiber.dom) {
        parentFiber = parentFiber.return
      }
      return parentFiber
    }
    return null
  }

  // DOMを消す関数
  const commitDeletion = (
    parentDOM: FiberNodeDom,
    DOM: NonNullable<FiberNodeDom>
  ) => {
    if (isDef(parentDOM)) {
      // parentDOMが存在する場合は、DOMを削除する
      // つまり親要素にDOMが存在する場合は、DOMを削除する
      parentDOM.removeChild(DOM)
    }
  }

  // DOMを置き換える関数
  const commitReplacement = (
    parentDOM: FiberNodeDom,
    DOM: NonNullable<FiberNodeDom>
  ) => {
    if (isDef(parentDOM)) {
      // parentDOMが存在する場合は、DOMを置き換える
      parentDOM.appendChild(DOM)
    }
  }
  const commitWork = (fiberNode?: FiberNode) => {
    if (fiberNode) {
      if (fiberNode.dom) {
        const parentFiber = findParentFiber(fiberNode)
        const parentDOM = parentFiber?.dom

        switch (fiberNode.effectTag) {
          case "REPLACEMENT":
            commitReplacement(parentDOM, fiberNode.dom)
            break
          case "UPDATE":
            updateDOM(
              fiberNode.dom,
              fiberNode.alternate ? fiberNode.alternate.props : {},
              fiberNode.props
            )
            break
          default:
            break
        }
      }

      commitWork(fiberNode.child) // 再帰的に子要素を処理していく
      commitWork(fiberNode.sibling) // 同じレベルの兄弟要素を再起的に処理していく
    }
  }

  for (const deletion of deletions) {
    if (deletion.dom) {
      const parentFiber = findParentFiber(deletion)
      commitDeletion(parentFiber?.dom, deletion.dom)
    }
  }

  if (wipRoot !== null) {
    // work-in-progress root
    commitWork(wipRoot.child) // ルートの子要素のfiberNodeをcommitWorkで処理していく
    currentRoot = wipRoot // 最新状態を反映
  }
}

// Reactが規定している Reconciliationを模倣した関数
const reconcileChildren = (
  fiberNode: FiberNode, // 現在のFiberツリー
  elements: VirtualElement[] = [] // 仮想DOMのリスト
) => {
  let index = 0 // ...現在処理中の要素(fiber)のインデックス
  let oldFiberNode: FiberNode | undefined = void 0 // ... 前回レンダリング時のfiberツリーから取得した子ノード
  let prevSibling: FiberNode | undefined = void 0 //  ... 直前に処理した兄弟ノード
  const virtualElements = elements.flat(Infinity) // 1次元配列にする

  // alternate === 前回レンダリング時のfiberNode
  // 前回レンダリング時のfiberツリーから取得した子ノードをoldFiberNodeに格納
  if (fiberNode.alternate?.child) {
    oldFiberNode = fiberNode.alternate.child
  }

  // ここで新しいfiberNodeを作成する
  while (
    index < virtualElements.length || // ...仮想DOMの要素が残っている
    typeof oldFiberNode !== "undefined" // ...前回レンダリング時のfiberツリーから取得した子ノードが残っている
  ) {
    const virtualElement = virtualElements[index]
    let newFiber: FiberNode | undefined = void 0

    const isSameType = Boolean(
      oldFiberNode &&
        virtualElement &&
        oldFiberNode.type === virtualElement.type
    )

    if (isSameType && oldFiberNode) {
      newFiber = {
        type: oldFiberNode.type,
        dom: oldFiberNode.dom,
        alternate: oldFiberNode,
        props: virtualElement.props, // propsを更新
        return: fiberNode,
        effectTag: "UPDATE", // 更新フラグを立てる
      }
    }
    if (!isSameType && Boolean(virtualElement)) {
      newFiber = {
        type: virtualElement.type,
        dom: null,
        alternate: null,
        props: virtualElement.props,
        return: fiberNode,
        effectTag: "REPLACEMENT",
      }
    }
    if (!isSameType && oldFiberNode) {
      // 古いfiberNodeが存在する場合は、fiberNodeを削除用の配列に格納
      deletions.push(oldFiberNode)
    }

    if (oldFiberNode) {
      //　古いfiberNodeが存在する場合は、その兄弟ノードをoldFiberNodeに格納して、次のループに進むよう仕向ける
      // whileの条件式の1つに、"typeof oldFiberNode !== "undefined"があるので、古いfiberNodeが存在する限り、ループは続く
      oldFiberNode = oldFiberNode.sibling
    }

    if (index === 0) {
      fiberNode.child = newFiber
    } else if (typeof prevSibling !== "undefined") {
      // @ts-ignore
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index += 1
  }
}

const useState = <S>(initialState: S): [S, (value: S) => void] => {
  const fiberNode: FiberNode<S> = wipFiber
  const hook: {
    state: S
    queue: S[]
  } = fiberNode?.alternate?.hooks
    ? fiberNode.alternate.hooks[hookIndex]
    : {
        state: initialState,
        queue: [],
      }

  while (hook.queue.length) {
    let newState = hook.queue.shift()
    if (isPlainObject(hook.state) && isPlainObject(newState)) {
      newState = { ...hook.state, ...newState }
    }
    if (isDef(newState)) {
      hook.state = newState
    }
  }

  if (typeof fiberNode.hooks === "undefined") {
    fiberNode.hooks = []
  }

  fiberNode.hooks.push(hook)
  hookIndex += 1

  const setState = (value: S) => {
    hook.queue.push(value)
    if (currentRoot) {
      wipRoot = {
        type: currentRoot.type,
        props: currentRoot.props,
        dom: currentRoot.dom,
        alternate: currentRoot,
      }
      nextUnitOfWork = wipRoot
      deletions = []
      currentRoot = null
    }
  }

  return [hook.state, setState]
}

const performUnitOfWork = (fiberNode: FiberNode): FiberNode | null => {
  const { type } = fiberNode
  switch (typeof type) {
    case "function": {
      wipFiber = fiberNode
      // @ts-ignore
      wipFiber.hooks = []
      hookIndex = 0
      let children: ReturnType<ComponentFunction>

      if (Object.getPrototypeOf(type).REACT_COMPONENT) {
        const C = type
        const component = new C(fiberNode.props)
        const [state, setState] = useState(component.state)
        component.props = fiberNode.props
        component.state = state
        component.setState = setState
        children = component.render.bind(component)()
      } else {
        children = type(fiberNode.props)
      }
      reconcileChildren(fiberNode, [
        isVirtualElement(children)
          ? children
          : createTextElement(String(children)),
      ])
      break
    }
    case "number":
    case "string":
      if (!fiberNode.dom) {
        fiberNode.dom = createDOM(fiberNode)
      }
      reconcileChildren(fiberNode, fiberNode.props.children)
      break
    case "symbol":
      if (type === Fragment) {
        reconcileChildren(fiberNode, fiberNode.props.children)
      }
      break
    default:
      if (typeof fiberNode.props !== "undefined") {
        reconcileChildren(fiberNode, fiberNode.props.children)
      }
      break
  }

  if (fiberNode.child) {
    return fiberNode.child
  }
  let nextFiberNode: FiberNode | undefined = fiberNode

  while (typeof nextFiberNode !== "undefined") {
    if (nextFiberNode.sibling) {
      return nextFiberNode.sibling
    }
    nextFiberNode = nextFiberNode.return
  }

  return null
}

const workLoop = (deadline: IdleDeadline) => {
  while (nextUnitOfWork && deadline.timeRemaining() > 1) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  window.requestIdleCallback(workLoop)
}

const render = (element, container) => {
  // DOMを作る
  const DOM = createDOM(element)

  // 引数elementのprops.childrenをループ
  if (Array.isArray(element.props.children)) {
    for (const child of element.props.children) {
      // childがVirtualElementであれば、再帰的にrenderを実行する
      // そうでなければ、
      render(child, DOM)
    }
  }

  // containerにDOMを追加する
  container.appendChild(DOM)
}

void (function main() {
  window.requestIdleCallback(workLoop)
})()

export { createElement, render, useState, Component, Fragment }

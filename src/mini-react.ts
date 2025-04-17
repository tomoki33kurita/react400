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
  }
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
const isVirtualELement = (e: unknown): e is VirtualElement =>
  typeof e === "object"

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
    isVirtualELement(c) ? c : createTextElement(String(c))
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

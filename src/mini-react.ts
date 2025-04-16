type VirtualElementType = string | Function

type VirtualElement = {
  type: VirtualElementType
  props: {
    [key: string]: unknown
  }
}

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

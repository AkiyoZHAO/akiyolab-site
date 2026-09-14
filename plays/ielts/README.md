# IELTS Deck

IELTS Deck 只负责选练习与记录是否完成，不接管专项工具内部的学习状态。

## v1 卡组

- **Speaking Part 2**：原生抽题，1 分钟准备 + 2 分钟作答。
- **Paraphrase Network**：打开独立的 `ielts-reading-paraphrase-network`，完成一轮后回到本页结算。

暂不加入 Writing；听写优先使用成熟外部工具；更多同义替换玩法等实际使用后再设计。

## Events

`play = "ielts"`：

- `ielts_pending`：抽到并开始一轮；
- `ielts_done`：完成；
- `ielts_skip`：没做或打断。

payload 包含 `card_id / skill / mode / title / duration / source`。IELTS events 进入共享时间线，**不产生时间代币**。

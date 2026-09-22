/** Spoken invitations during a quiet turn, without asking for a correct answer. */
const invitations: Record<string, [string, string]> = {
  'red-hen-seed': ['这么小的一粒麦种，竟然能长出麦子，再做成面包，真有趣。', 'One tiny wheat seed can grow into wheat and become bread. What a beginning!'],
  'red-hen-harvest': ['小红母鸡一边照顾小鸡，一边收麦子，真忙呀。', 'Little Red Hen has chicks to care for and wheat to cut. Such a busy day!'],
  'red-hen-flour': ['麦粒在磨坊里磨成细细的面粉，面包的故事还在继续呢。', 'The mill turns the grain into soft flour. Our bread story is coming along!'],
  'red-hen-bread': ['小红母鸡认真照着食谱做面包，厨房里慢慢飘出香味了。', 'Little Red Hen follows the recipe carefully. I can almost smell her bread!'],
  'red-hen-finish': ['我想帮小红母鸡喂喂小鸡，她就能歇一会儿。你想到什么，也可以告诉我。', 'I would help feed the chicks so Little Red Hen could rest. I wonder what you would do.'],
  'penny-acorn': ['树上掉下一颗小橡子，把佩妮吓了一跳。我们陪她仔细看看吧。', 'That little acorn gave Henny Penny quite a surprise. Let’s take a closer look with her.'],
  'penny-king': ['佩妮急着去找国王，朋友们也跟上来了。', 'Henny Penny is hurrying to find the King, and her friends are coming along.'],
  'penny-friends': ['我真想陪朋友们回树下看看。也许地上就有线索呢。', 'I would like to look under the tree with them. There might be a clue on the ground.'],
  'penny-fox': ['这个黑黑的洞，原来是狐狸自己的家。我们陪朋友们看看吧。', 'That dark hole is really the fox’s own home. Let’s look carefully with the friends.'],
  'penny-stop': ['朵朵说了等一等，大家就停住了。有疑问，说出来很有用呢。', 'Goosey Poosey says to wait, and everyone stops. Speaking up can really help.'],
  'penny-home': ['终于弄清楚啦！只是橡子掉下来了，朋友们都平安回家了。', 'Mystery solved! It was only an acorn, and all the friends got safely home.'],
  'pick-dish': ['蹦蹦的肚子咕咕叫啦！我已经闻到厨房里的香味了。你想做点什么呢？', 'Bengbeng’s tummy is rumbling! I can almost smell our kitchen. What would you cook?'],
  'long-noodles': ['面条越拉越长，像跳绳一样！我真想看看它能拉多远。', 'Those noodles stretch like a jump rope! I wonder how far they could reach.'],
  'count-dumplings': ['三个胖饺子在锅里游泳呢，一个、两个、三个！真可爱。', 'Our dumplings are having a swim. One, two, three little dumplings!'],
  'blow-on-it': ['热气还在往上飘呢，我们陪蹦蹦轻轻吹一吹吧。', 'The steam is still rising. Let’s help Bengbeng blow gently on the bowl.'],
  'bengbeng-thanks': ['蹦蹦吃得好开心，还带来了大胡萝卜！你觉得她会说什么呢？', 'Bengbeng looks so happy, and she brought a carrot! I wonder what she’ll say.'],
  'your-favorite-food': ['忙了一天，啾啾也饿啦。我想给他做一碗热乎乎的面。你呢？', 'ChooChoo is hungry after all that cooking. I’d make him a warm bowl of noodles. How about you?'],
}

export function storyFollowup(checkpointID: string, language: 'chinese' | 'english') {
  const line = invitations[checkpointID] || ['有时候，静静听故事也很有趣。你想到什么，随时可以告诉我。', 'Sometimes it’s lovely just to listen. You can jump into our adventure whenever an idea comes along.']
  return line[language === 'english' ? 1 : 0]
}

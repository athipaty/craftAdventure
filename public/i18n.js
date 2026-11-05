"use strict";

// =====================================================================
// Translations. The game is written in English, and everything it shows passes
// through t(): text put on the page is translated as it appears, and so is text
// drawn on the canvases. To add a word, add it to the table below. Text with
// numbers or names in it goes in the patterns, where inner parts are translated
// again by T(). Anything with no translation simply stays in English.
// =====================================================================

const TH_WORDS = {
  // Worlds, levels and rules
  "Green Forest": "ป่าเขียว", "Sun Desert": "ทะเลทรายสุริยะ", "Frozen Peaks": "ยอดเขาน้ำแข็ง", "Lava Core": "แกนลาวา",
  "Easy": "ง่าย", "Normal": "ปกติ", "Hard": "ยาก", "Expert": "เซียน",
  "rust attacks on every wave": "สนิมโจมตีทุกเวฟ", "a boss every 4 waves": "มีบอสทุก 4 เวฟ",
  "Overdrive recharges slower": "โอเวอร์ไดรฟ์ชาร์จช้าลง", "enemies grow 25% faster": "ศัตรูเพิ่มเร็วขึ้น 25%",

  // Ranks and enemies
  "Recruit": "ทหารใหม่", "Recruits": "ทหารใหม่", "Knight": "อัศวิน", "Knights": "อัศวิน", "Champion": "แชมเปี้ยน", "Champions": "แชมเปี้ยน", "Hero": "ฮีโร่", "Heroes": "ฮีโร่",
  "Goblins": "ก็อบลิน", "Orcs": "ออร์ค", "Trolls": "โทรลล์", "Demons": "ปีศาจ",
  "Goblin runners": "ก็อบลินวิ่งเร็ว", "Armoured brutes": "ยักษ์เกราะ", "Rust shamans": "หมอผีสนิม", "Frost trolls": "โทรลล์น้ำแข็ง", "Fire imps": "ภูตไฟ",
  "rusts your gears": "ทำให้เฟืองเป็นสนิม", "blocks empty cells": "ปิดช่องว่าง", "swaps your gears": "สลับเฟือง", "raises a shield": "ตั้งโล่", "extra enemies": "ศัตรูเพิ่ม",
  "soldiers do less": "ทหารทำดาเมจน้อยลง", "freezes the main gear": "แช่แข็งเฟืองหลัก", "burns gear progress": "เผาความคืบหน้าเฟือง", "rust attacks": "สนิมโจมตี",
  "your soldiers count double": "ทหารนับเป็นสองเท่า", "a row is blocked": "แถวหนึ่งถูกปิด", "calls reinforcements": "เรียกกำลังเสริม", "drains gear progress": "ดูดความคืบหน้าเฟือง",
  "melts your gears": "หลอมเฟือง", "short and fierce": "สั้นแต่ดุเดือด", "long, pays 5 coins": "ยาวนาน ได้ 5 เหรียญ",
  "Main gear speed": "ความเร็วเฟืองหลัก", "Starting army": "กองทัพตอนเริ่มเทียบศัตรู", "Next wave's army": "กองทัพเวฟหน้าเทียบศัตรู", "Overdrive recharge": "เวลาชาร์จโอเวอร์ไดรฟ์", "Lightning power": "พลังสายฟ้า", "Scrap refund": "เงินคืนจากการแยกเฟือง", "Gears hit by rust": "เฟืองที่โดนสนิม", "Coins from this run": "เหรียญจากรอบนี้", "Training cost": "ค่าฝึก", "Soldiers against brutes": "ทหารเมื่อสู้กับพวกเกราะหนา", "Freeze time": "เวลาแข็งตัว", "Gears burned": "เฟืองที่ถูกเผา", "Hit kept per gear": "แรงที่เหลือต่อเฟือง", "Damage to bosses": "ความเสียหายต่อบอส", "Bomb gear blast": "แรงระเบิดเฟืองระเบิด", "Big gear soldiers": "ทหารจากเฟืองใหญ่", "Booster strength": "พลังเฟืองบูสต์", "Rust fixed per blast": "สนิมที่แก้ได้ต่อการระเบิด", "Lightning in Overdrive": "เวลาชาร์จสายฟ้าตอนโอเวอร์ไดรฟ์", "Full Rally charge": "พลังชาร์จเต็ม", "Line combo payout": "ผลคอมโบแถว", "Soldiers per merge": "ทหารต่อการรวม", "Lightning fills gears": "สายฟ้าเติมเฟือง", "Second chances": "โอกาสแก้ตัว", "Army rank": "ยศกองทัพ", "Soldiers per second": "ทหารต่อวินาที", "Gears on board": "เฟืองบนกระดาน", "On": "เปิด", "Off": "ปิด",
  "Goblins have overrun the trees. But who is leading them?": "ก็อบลินบุกยึดป่า แต่ใครคือผู้นำของพวกมัน?", "Tracks vanish into the dunes. Something huge moves below the sand.": "รอยเท้าหายไปในเนินทราย มีบางอย่างตัวใหญ่เคลื่อนไหวอยู่ใต้ผืนทราย", "The mountains have turned white, and the cold is spreading.": "ภูเขากลายเป็นสีขาว และความหนาวกำลังแผ่ขยาย", "Something burns below the world. This is where it all began.": "มีบางอย่างลุกไหม้อยู่ใต้โลก ที่นี่คือจุดเริ่มต้นของทุกอย่าง", "New!": "ใหม่!",
  "Treasure goblin": "ก็อบลินสมบัติ", "A treasure goblin! Tap it before it escapes to grab what it's carrying.": "ก็อบลินสมบัติ! แตะก่อนที่มันจะหนีเพื่อคว้าสิ่งที่มันถืออยู่", "Sometimes runs past carrying coins or a gear. Tap it before it escapes.": "บางครั้งจะวิ่งผ่านมาพร้อมเหรียญหรือเฟือง แตะก่อนที่มันจะหนีไป", "It got away!": "มันหนีไปแล้ว!", "Treasure! Free gear": "สมบัติ! ได้เฟืองฟรี", "Gotcha!": "จับได้แล้ว!", "Catch 10 treasure goblins": "จับก็อบลินสมบัติ 10 ตัว",
  "Choose your path": "เลือกเส้นทาง", "Safe road": "ทางปลอดภัย", "No extra danger": "ไม่มีอันตรายเพิ่ม", "No bonus": "ไม่มีโบนัส", "Elite ambush": "ซุ่มโจมตีชั้นยอด", "40% more enemies": "ศัตรูเพิ่ม 40%", "Win for better reward choices": "ชนะเพื่อรับตัวเลือกรางวัลที่ดีขึ้น", "Treasure trail": "เส้นทางสมบัติ", "Enemies grow 25% faster": "ศัตรูเพิ่มเร็วขึ้น 25%", "A treasure goblin, and win for +10 coins": "ก็อบลินสมบัติ และชนะรับ +10 เหรียญ", "Supply camp": "ค่ายเสบียง", "20% more enemies": "ศัตรูเพิ่ม 20%", "A level 2 gear right now": "เฟืองเลเวล 2 ทันที", "Elite beaten!": "ชนะชั้นยอดแล้ว!", "Every few waves, pick a route for the next one. Danger brings better rewards, or take the safe road.": "ทุกไม่กี่เวฟ เลือกเส้นทางสำหรับเวฟถัดไป อันตรายให้รางวัลที่ดีกว่า หรือจะเลือกทางปลอดภัยก็ได้",
  "Pick a chest!": "เลือกหีบ!", "Boss treasure!": "สมบัติบอส!", "Boss chests": "หีบบอส", "Beat a boss and pick one of three chests for coins or a strong gear. The others open too, so you'll see what you missed.": "ชนะบอสแล้วเลือก 1 ใน 3 หีบ เพื่อรับเหรียญหรือเฟืองแกร่ง หีบที่เหลือจะเปิดด้วย ให้เห็นว่าพลาดอะไรไป", "Treasure hunter": "นักล่าสมบัติ", "Open 10 boss chests": "เปิดหีบบอส 10 ใบ", "Continue": "ไปต่อ",
  "Collection": "สมุดสะสม", "Tap an entry": "แตะที่รายการ", "Keep playing to find the rest.": "เล่นต่อเพื่อค้นหาที่เหลือ", "You've found everything on this page.": "คุณพบทุกอย่างในหน้านี้แล้ว", "Not found yet. Keep playing to discover it.": "ยังไม่พบ เล่นต่อเพื่อค้นพบมัน", "The first enemies you'll meet.": "ศัตรูกลุ่มแรกที่คุณจะได้เจอ", "Rewards": "รางวัล", "Enemies": "ศัตรู", "Bosses": "บอส",
  "Free": "ฟรี", "Level": "เลเวล", "Free gear": "เฟืองฟรี", "A monster dropped a gear! Drag it from the tray onto the board, next to your chain, or tap it to place it there.": "มอนสเตอร์ทำเฟืองหล่น! ลากจากถาดไปวางบนกระดานให้ต่อกับโซ่ หรือแตะเพื่อให้วางให้", "The only way to get more gears. Monsters drop them into the tray below the board, and every boss drops a level 2 gear at half health. A few are special gears. Drag one onto the board, or tap it.": "เป็นทางเดียวที่จะได้เฟืองเพิ่ม มอนสเตอร์จะทำหล่นลงถาดใต้กระดาน และบอสทุกตัวจะทำเฟืองเลเวล 2 หล่นเมื่อพลังเหลือครึ่งหนึ่ง บางตัวเป็นเฟืองพิเศษ ลากไปวางบนกระดานหรือแตะก็ได้",
  "Frozen": "แข็งตัว", "The main gear is frozen. Use Lightning to thaw it.": "เฟืองหลักถูกแช่แข็ง ใช้สายฟ้าเพื่อละลาย", "Risky deal": "ข้อตกลงเสี่ยง",
  "Rush wave": "เวฟบุกเร็ว", "Siege wave": "เวฟล้อมเมือง",

  // Bosses
  "Rust King": "ราชาสนิม", "Wall Maker": "จอมสร้างกำแพง", "Scrambler": "จอมสลับ", "Iron Guard": "ผู้พิทักษ์เหล็ก",
  "Goblin Warlord": "จอมทัพก็อบลิน", "Sand Wyrm": "หนอนยักษ์ทะเลทราย", "Frost Queen": "ราชินีน้ำแข็ง", "Magma King": "ราชาแมกมา",
  "Your gears will crumble to dust!": "เฟืองของเจ้าจะผุพังเป็นผุยผง!", "You shall not build here!": "เจ้าจะสร้างที่นี่ไม่ได้!", "Let's mix things up!": "มาสลับกันหน่อย!",
  "Nothing gets through my shield!": "ไม่มีอะไรผ่านโล่ข้าได้!", "This forest is mine! Attack!": "ป่านี้เป็นของข้า! บุก!", "The sands will swallow your work!": "ผืนทรายจะกลืนผลงานของเจ้า!",
  "Everything freezes in the end.": "ทุกสิ่งจะแข็งตัวในที่สุด", "I will melt your machine to slag!": "ข้าจะหลอมเครื่องจักรของเจ้าให้เป็นตะกรัน!",

  // Heroes and looks
  "A full Rally takes 3 seconds, not 5": "รวมพลเต็มใช้แค่ 3 วินาที แทน 5 วินาที", "Stormcaller": "ผู้เรียกพายุ", "Lightning hits harder and recharges faster, and every 3rd strike is triple": "สายฟ้าแรงขึ้นและชาร์จเร็วขึ้น ทุกครั้งที่ 3 แรง 3 เท่า",
  "Engineer": "วิศวกร", "Starts with a Booster gear, main gear 5% faster": "เริ่มด้วยเฟืองบูสเตอร์ เฟืองหลักเร็วขึ้น 5%", "Berserker": "นักรบคลั่ง",
  "Overdrive lasts 3 seconds longer, and soldiers count double during it": "โอเวอร์ไดรฟ์นานขึ้น 3 วินาที และทหารนับเป็นสองเท่าระหว่างนั้น", "Guardian": "ผู้พิทักษ์",
  "Bosses are 15% weaker, and the first rust attack of each wave is blocked": "บอสอ่อนลง 15% และป้องกันสนิมครั้งแรกของแต่ละเวฟ",
  "Blue army": "กองทัพน้ำเงิน", "Red army": "กองทัพแดง", "Green army": "กองทัพเขียว", "Purple army": "กองทัพม่วง", "Shadow army": "กองทัพเงา", "Golden army": "กองทัพทอง",
  "Brass gears": "เฟืองทองเหลือง", "Steel gears": "เฟืองเหล็ก", "Copper gears": "เฟืองทองแดง", "Jade gears": "เฟืองหยก", "Ruby gears": "เฟืองทับทิม", "Amethyst gears": "เฟืองอเมทิสต์",
  "Just the usual": "แบบปกติ", "No extra gear": "ไม่มีเฟืองเพิ่ม", "Starting gear": "เฟืองเริ่มต้น", "Army colours": "สีกองทัพ", "Gear colours": "สีเฟือง",
  "Start each run with a Booster gear too": "เริ่มทุกรอบพร้อมเฟืองบูสเตอร์", "Start each run with a Big gear too": "เริ่มทุกรอบพร้อมเฟืองใหญ่", "Start each run with a Bomb gear too": "เริ่มทุกรอบพร้อมเฟืองระเบิด",
  "Start each run with a Far gear too": "เริ่มทุกรอบพร้อมเฟืองไกล", "Start each run with a Lone gear too": "เริ่มทุกรอบพร้อมเฟืองเดี่ยว",
  "Tap to use": "แตะเพื่อใช้", "A new look": "ลุคใหม่", "In use": "กำลังใช้", "Use": "ใช้", "Max": "สูงสุด", "Epic": "มหากาพย์", "Rare": "หายาก",

  // Weekly challenges
  "Bomb Week": "สัปดาห์ระเบิด", "Every gear that drops is a bomb gear": "เฟืองที่หล่นทุกตัวเป็นเฟืองระเบิด", "Boss Rush": "บอสถล่ม", "A boss every 3 waves": "มีบอสทุก 3 เวฟ",
  "Rust Season": "ฤดูสนิม", "Rust attacks on every wave": "สนิมโจมตีทุกเวฟ", 
  "Overdrive Week": "สัปดาห์โอเวอร์ไดรฟ์", "Overdrive recharges 3x faster, but enemies are stronger": "โอเวอร์ไดรฟ์ชาร์จเร็วขึ้น 3 เท่า แต่ศัตรูแกร่งขึ้น",
  "Daily challenge": "ภารกิจท้าทายรายวัน", "A new challenge comes next week.": "ภารกิจใหม่จะมาสัปดาห์หน้า", "You have cleared every world!": "คุณผ่านครบทุกโลกแล้ว!", "Endless mode!": "โหมดไม่สิ้นสุด!",

  // Deals
  "50% more enemies": "ศัตรูเพิ่ม 50%", "enemies grow 50% faster": "ศัตรูเพิ่มเร็วขึ้น 50%", "no lightning": "ไม่มีสายฟ้า",

  // Upgrades
  "Spare gears": "เฟืองสำรอง", "Start each run with 1 more gear": "เริ่มแต่ละรอบพร้อมเฟืองเพิ่ม 1 ตัว", "Start every wave with more soldiers": "เริ่มทุกเวฟด้วยทหารมากขึ้น", "Boss breaker": "นักล้มบอส",
  "Bosses have 10% less health and help": "บอสมีพลังชีวิตและกำลังเสริมลดลง 10%", "Oiled main gear": "เฟืองหลักหยอดน้ำมัน", "The one-tooth gear turns 5% faster": "เฟืองฟันเดียวหมุนเร็วขึ้น 5%",
  "Long Overdrive": "โอเวอร์ไดรฟ์ยาวนาน", "Overdrive lasts 1 second longer": "โอเวอร์ไดรฟ์นานขึ้น 1 วินาที", 
  "Bigger crate": "ลังใหญ่ขึ้น", "Choose from 4 rewards after each wave": "เลือกจาก 4 รางวัลหลังแต่ละเวฟ", "Coin purse": "ถุงเหรียญ", "Earn 10% more coins from each run": "ได้เหรียญเพิ่ม 10% จากแต่ละรอบ",
  "Thunder": "สายฟ้าฟาด", "Lightning strikes hit 25% harder": "สายฟ้าแรงขึ้น 25%", "Quick storm": "พายุเร็ว", "Lightning recharges 0.25 seconds faster": "สายฟ้าชาร์จเร็วขึ้น 0.25 วินาที",
  "Cooling fans": "พัดลมระบายความร้อน", "Overdrive recharges 3 seconds faster": "โอเวอร์ไดรฟ์ชาร์จเร็วขึ้น 3 วินาที", "Oil can": "กระป๋องน้ำมัน", "Rust attacks hit 5% fewer of your gears": "สนิมโจมตีเฟืองน้อยลง 5%",
  "Spare parts": "อะไหล่สำรอง", "Rewards can offer 1 more special gear": "รางวัลให้เฟืองพิเศษได้เพิ่ม 1 ตัว", "Drill sergeant": "ครูฝึก", "Training costs 10% less": "ค่าฝึกถูกลง 10%", "Upgrades": "อัปเกรด",

  // Rewards
  "Big gear": "เฟืองใหญ่", "Fills half as fast, then sends 5 soldiers": "เติมช้าลงครึ่งหนึ่ง แล้วส่งทหาร 5 นาย", "Booster gear": "เฟืองบูสเตอร์", "Gears touching it get an extra 25% per hit, and glow green": "เฟืองที่ติดกันได้เพิ่ม 25% ต่อการหมุน และเรืองแสงสีเขียว",
  "Bomb gear": "เฟืองระเบิด", "Fills half as fast, then blasts 2 enemies": "เติมช้าลงครึ่งหนึ่ง แล้วระเบิดศัตรู 2 ตัว", "Faster main gear": "เฟืองหลักเร็วขึ้น", "The one-tooth gear turns 10% faster": "เฟืองฟันเดียวหมุนเร็วขึ้น 10%",
  "Veterans": "ทหารผ่านศึก", "Reinforcements": "กำลังเสริม", "Start the next wave with extra soldiers": "เริ่มเวฟถัดไปด้วยทหารเพิ่ม",
  "Far gear": "เฟืองไกล", "Pays 25% more for each step away from the main gear": "ส่งทหารเพิ่ม 25% ต่อทุกก้าวที่ห่างจากเฟืองหลัก", "Lone gear": "เฟืองเดี่ยว", "Pays 50% more for each empty space beside it": "ส่งทหารเพิ่ม 50% ต่อทุกช่องว่างข้าง ๆ",
  "Cooling oil": "น้ำมันระบายความร้อน", "Overdrive recharges 20% faster": "โอเวอร์ไดรฟ์ชาร์จเร็วขึ้น 20%", "Static charge": "ประจุไฟฟ้า", "Lightning strikes hit 30% harder": "สายฟ้าแรงขึ้น 30%",
  "Scrap dealer": "พ่อค้าเศษเหล็ก", "Scrapping gives 30% more soldiers": "แยกเฟืองได้ทหารเพิ่ม 30%", "Thick oil": "น้ำมันข้น", "War chest": "หีบสงคราม", "Earn 25% more coins from this run": "ได้เหรียญเพิ่ม 25% จากรอบนี้",
  "Drill manual": "คู่มือฝึก", "Training costs 25% less": "ค่าฝึกถูกลง 25%", "Sharp spears": "หอกคม", "Soldiers hit armoured brutes at full strength": "ทหารโจมตียักษ์เกราะได้เต็มแรง",
  "Antifreeze": "สารกันแข็ง", "Freezes last half as long": "การแช่แข็งสั้นลงครึ่งหนึ่ง", "Fireproof grease": "จาระบีกันไฟ", "Fire imps burn 1 gear instead of 2": "ภูตไฟเผาเฟือง 1 ตัวแทน 2 ตัว",
  "Tight chain": "โซ่แน่น", "Hits fade less along a chain": "แรงหมุนอ่อนลงน้อยลงตามแถว", "Boss hunter": "นักล่าบอส", "Everything hurts bosses 25% more": "ทุกอย่างทำดาเมจบอสเพิ่ม 25%",
  "Demolition": "นักระเบิด", "Bomb gears blast 50% more enemies": "เฟืองระเบิดทำลายศัตรูเพิ่ม 50%", "Heavy load": "บรรทุกหนัก", "Big gears send 40% more soldiers": "เฟืองใหญ่ส่งทหารเพิ่ม 40%",
  "Turbo booster": "เทอร์โบบูสเตอร์", "Booster gears are 50% stronger": "เฟืองบูสเตอร์แรงขึ้น 50%", "Blast cleaner": "ระเบิดล้างสนิม", "Each bomb gear blast fixes a rusted gear": "ทุกการระเบิดซ่อมเฟืองสนิม 1 ตัว",
  "Storm engine": "เครื่องยนต์พายุ", "Lightning recharges 4x faster during Overdrive": "สายฟ้าชาร์จเร็วขึ้น 4 เท่าระหว่างโอเวอร์ไดรฟ์", "War drums": "กลองศึก", "A full Rally charges with 100% more, not 50%": "รวมพลเต็มพุ่งแรงขึ้น 100% แทน 50%",
  "Pattern master": "เจ้าแห่งแพตเทิร์น", "Line and square combos are twice as strong": "คอมโบแถวและสี่เหลี่ยมแรงขึ้น 2 เท่า", "Forge bonus": "โบนัสเตาหลอม", "Every merge also sends soldiers to the battle": "ทุกการรวมเฟืองจะส่งทหารไปรบด้วย",
  "Forged gear": "เฟืองตีขึ้นรูป", "A free level 3 gear": "เฟืองเลเวล 3 ฟรี", "Charged strike": "สายฟ้าชาร์จ", "Lightning also fills every connected gear": "สายฟ้าเติมเฟืองทุกตัวที่ต่อกันด้วย",
  "Second wind": "ลมหายใจที่สอง", "Second wind!": "ลมหายใจที่สอง!", "The next time you are overrun, the line resets instead": "ครั้งหน้าที่ถูกตีแตก แนวรบจะรีเซ็ตแทน", "Field promotion": "เลื่อนยศในสนาม",
  "Your army moves up a rank for free": "กองทัพเลื่อนยศฟรี 1 ขั้น", "Clockwork": "กลไกนาฬิกา", "The one-tooth gear turns 25% faster": "เฟืองฟันเดียวหมุนเร็วขึ้น 25%",
  "Enemy rush": "ศัตรูบุกเร็ว", "Rust storm": "พายุสนิม", "Double soldiers": "ทหารสองเท่า", "Blocked row": "แถวถูกปิด", "FAR": "ไกล", "LONE": "เดี่ยว", "TAP": "แตะ",

  // Tips and stories
  "Boss wave! Soldiers and bombs hurt the boss. Empty its health bar to win.": "เวฟบอส! ทหารและระเบิดทำดาเมจบอสได้ ลดหลอดพลังชีวิตให้หมดเพื่อชนะ",
  "Rust! A rusted gear stops working and blocks the gears behind it. Tap it to fix it.": "สนิม! เฟืองที่เป็นสนิมจะหยุดทำงานและขวางเฟืองข้างหลัง แตะเพื่อซ่อม",
  "The main gear turns by itself. Each hit fills the gear beside it, and at 100% that gear sends a soldier to fight.": "เฟืองหลักหมุนเอง ทุกครั้งที่กระทบจะเติมเฟืองข้าง ๆ เมื่อถึง 100% เฟืองนั้นจะส่งทหารไปรบ",
  "The boss glows before it attacks. Keep Lightning ready, then press it during the glow to cancel the attack!": "บอสจะเรืองแสงก่อนโจมตี เก็บสายฟ้าไว้ให้พร้อม แล้วกดตอนเรืองแสงเพื่อยกเลิกการโจมตี!",
  "\"Need 12 more\" means your army must grow first. Training costs soldiers, and the game won't let it lose you the wave.": "\"ต้องการอีก 12\" หมายถึงกองทัพต้องใหญ่ขึ้นก่อน การฝึกต้องใช้ทหาร และเกมจะไม่ให้ฝึกจนทำให้แพ้เวฟ",
  "Soldiers push the line. Get your side of the bar to 70% to win the wave. If it falls to 30%, you lose.": "ทหารดันแนวรบ ดันฝั่งคุณให้ถึง 70% เพื่อชนะเวฟ ถ้าเหลือ 30% คุณแพ้",
  "Overdrive is ready! Tap it to spin the main gear 3x faster for a few seconds, then wait for it to recharge.": "โอเวอร์ไดรฟ์พร้อมแล้ว! กดเพื่อให้เฟืองหลักหมุนเร็วขึ้น 3 เท่าสักครู่ แล้วรอชาร์จใหม่",
  "Drag a gear to move it. Drag it onto the red bar that appears to scrap it and get some soldiers back.": "ลากเฟืองเพื่อย้าย ลากไปที่แถบสีแดงที่ปรากฏเพื่อแยกเฟืองและรับทหารคืนบางส่วน",
  "Hits fade as they pass along a chain, so far-away gears fill more slowly. A booster in the chain brings them back to full strength.": "แรงหมุนจะอ่อนลงตามแถว เฟืองที่อยู่ไกลจึงเติมช้าลง เฟืองบูสเตอร์ในแถวจะคืนแรงให้เต็ม",
  "The Iron Guard raises a shield that blocks all damage. Press Break shield 5 times to break it.": "ผู้พิทักษ์เหล็กตั้งโล่กันดาเมจทั้งหมด กด ทำลายโล่ 5 ครั้งเพื่อทำลาย",
  "Rally holds your arriving soldiers back. When the button says Charge!, tap it to charge with 50% more, but your line gets no help while you wait.": "รวมพลจะเก็บทหารที่มาถึงไว้ เมื่อปุ่มขึ้นว่า พุ่งชน! ให้กดเพื่อพุ่งชนแรงขึ้น 50% แต่ระหว่างรอแนวรบจะไม่ได้รับทหารเพิ่ม",
  "You can train your army! Every new soldier becomes stronger, and prices count in soldiers of your new rank.": "ฝึกกองทัพได้แล้ว! ทหารใหม่ทุกนายจะแกร่งขึ้น และราคาจะนับตามทหารยศใหม่",
  "Press Lightning to strike the enemy! The button fills up as it recharges.": "กดสายฟ้าเพื่อโจมตีศัตรู! ปุ่มจะเติมเต็มเมื่อชาร์จใหม่",
  "Armoured brutes! Soldiers do less against them, but lightning and bombs hit at full strength.": "ยักษ์เกราะ! ทหารทำดาเมจได้น้อยลง แต่สายฟ้าและระเบิดยังแรงเต็มที่",
  "Frost trolls freeze your main gear to half speed. A lightning strike thaws it right away.": "โทรลล์น้ำแข็งทำให้เฟืองหลักช้าลงครึ่งหนึ่ง ใช้สายฟ้าละลายได้ทันที",
  "Fire imps burn the progress out of your gears. Win fast, before they burn it all.": "ภูตไฟเผาความคืบหน้าของเฟือง รีบชนะก่อนที่จะถูกเผาหมด",
  "Rust shamans keep rusting your gears. Tap rusted gears to fix them.": "หมอผีสนิมทำให้เฟืองเป็นสนิมเรื่อย ๆ แตะเฟืองสนิมเพื่อซ่อม",
  "Drag a gear onto a matching one to merge them into one stronger gear. Merging also frees up space.": "ลากเฟืองไปทับเฟืองชนิดเดียวกันเพื่อรวมเป็นเฟืองที่แรงขึ้น และยังได้ที่ว่างเพิ่ม",
  "Goblins have overrun the Green Forest! Build a machine, send your soldiers, and drive them out.": "ก็อบลินบุกป่าเขียว! สร้างเครื่องจักร ส่งทหาร แล้วขับไล่พวกมันออกไป",
  "The goblins fled to the Sun Desert, and armoured brutes have joined them. Your machine must grow.": "ก็อบลินหนีไปทะเลทรายสุริยะ และมียักษ์เกราะมาสมทบ เครื่องจักรของคุณต้องใหญ่ขึ้น",
  "High in the Frozen Peaks, frost trolls freeze everything they touch. Keep your gears turning.": "บนยอดเขาน้ำแข็ง โทรลล์น้ำแข็งแช่แข็งทุกสิ่งที่แตะ อย่าให้เฟืองหยุดหมุน",
  "All of this began at the Lava Core. Fire imps guard it, and the Magma King waits below. End it here.": "ทุกอย่างเริ่มที่แกนลาวา ภูตไฟเฝ้าอยู่ และราชาแมกมารออยู่เบื้องล่าง จบเรื่องนี้ที่นี่",
  "The forest is safe. But the goblins left tracks heading for the desert...": "ป่าปลอดภัยแล้ว แต่ก็อบลินทิ้งรอยเท้ามุ่งสู่ทะเลทราย...",
  "The Sand Wyrm sinks beneath the dunes. Far away, the mountains have turned white.": "หนอนยักษ์จมลงใต้เนินทราย ที่ไกลออกไป ภูเขาเริ่มขาวโพลน",
  "The Frost Queen falls and the ice begins to crack. Something burns below the world.": "ราชินีน้ำแข็งพ่ายแพ้ น้ำแข็งเริ่มแตก และมีบางสิ่งลุกไหม้อยู่ใต้โลก",
  "The Magma King is beaten, and the machines fall silent. Peace, at last... for now.": "ราชาแมกมาพ่ายแพ้ เครื่องจักรเงียบลง สันติภาพกลับคืนมา... อย่างน้อยก็ตอนนี้",

  // Titles and achievements
  "Apprentice": "ลูกมือ", "Mechanic": "ช่างเครื่อง", "Gearsmith": "ช่างเฟือง", "Master Gearsmith": "ปรมาจารย์ช่างเฟือง", "Gear Legend": "ตำนานเฟือง",
  "Out of the woods": "พ้นดงป่า", "Clear Green Forest": "ผ่านป่าเขียว", "Sun proof": "ทนแดด", "Clear Sun Desert": "ผ่านทะเลทรายสุริยะ", "Cold blooded": "เลือดเย็น", "Clear Frozen Peaks": "ผ่านยอดเขาน้ำแข็ง",
  "Gear Fight champion": "แชมป์ Gear Fight", "Clear Lava Core": "ผ่านแกนลาวา", "Quick draw": "ชักไว", "Counter 10 boss attacks": "สวนการโจมตีบอส 10 ครั้ง", "Untouchable": "ไร้เทียมทาน", "Counter 50 boss attacks": "สวนการโจมตีบอส 50 ครั้ง",
  "Star engineer": "วิศวกรดาวเด่น", "Earn all 12 world stars": "สะสมดาวครบ 12 ดวง", "Risk taker": "นักเสี่ยง", "Win 10 risky deals": "ชนะข้อตกลงเสี่ยง 10 ครั้ง", "Not so hard": "ไม่ยากเท่าไหร่", "Clear a world on Hard": "ผ่านโลกระดับยาก",
  "Expert engineer": "วิศวกรเซียน", "Clear a world on Expert": "ผ่านโลกระดับเซียน", "Daily driver": "เล่นทุกวัน", "Reach the goal of a daily challenge": "ทำเป้าหมายภารกิจรายวันสำเร็จ", "Habit forming": "ติดเป็นนิสัย", "Reach the goal of 7 daily challenges": "ทำเป้าหมายภารกิจรายวันสำเร็จ 7 ครั้ง",
  "Challenger": "ผู้ท้าชิง", "Finish a weekly challenge": "จบภารกิจประจำสัปดาห์", "Week after week": "สัปดาห์แล้วสัปดาห์เล่า", "Finish 5 weekly challenges": "จบภารกิจประจำสัปดาห์ 5 ครั้ง", "Collector": "นักสะสม", "Unlock 5 heroes or colours": "ปลดล็อกฮีโร่หรือสี 5 แบบ",
  "First win": "ชนะครั้งแรก", "Win a wave": "ชนะ 1 เวฟ", "Veteran": "ผู้ช่ำชอง", "Win 50 waves": "ชนะ 50 เวฟ", "Warlord": "จอมทัพ", "Win 250 waves": "ชนะ 250 เวฟ", "Unstoppable": "หยุดไม่อยู่", "Win 1,000 waves": "ชนะ 1,000 เวฟ",
  "Getting serious": "เริ่มจริงจัง", "Deep run": "ไปได้ไกล", "Long haul": "เส้นทางยาวไกล", "Beyond the wall": "เหนือกำแพง", "Giant slayer": "นักฆ่ายักษ์", "Beat a boss": "ชนะบอส", "Beat 10 bosses": "ชนะบอส 10 ตัว", "Boss nightmare": "ฝันร้ายของบอส", "Beat 50 bosses": "ชนะบอส 50 ตัว",
  "Better together": "รวมกันแข็งแกร่ง", "Merge two gears": "รวมเฟือง 2 ตัว", "Merge master": "เจ้าแห่งการรวม", "Merge gears 100 times": "รวมเฟือง 100 ครั้ง", "Top gear": "เฟืองสุดยอด", "Make a level 5 gear": "สร้างเฟืองเลเวล 5",
  "Arise, Knights": "ลุกขึ้น อัศวิน", "Storm caller": "ผู้เรียกพายุ", "Use 100 lightning strikes": "ใช้สายฟ้า 100 ครั้ง", "Blast 100 enemies with bombs": "ระเบิดศัตรู 100 ตัว", "Pattern spotter": "นักจับแพตเทิร์น", "Make a combo": "ทำคอมโบ", "Combo builder": "นักสร้างคอมโบ", "Make 25 combos": "ทำคอมโบ 25 ครั้ง",
  "No shortcuts": "ไม่มีทางลัด", "Rust remover": "นักกำจัดสนิม", "Fix 25 rusted gears": "ซ่อมเฟืองสนิม 25 ตัว", "Clean workshop": "โรงงานสะอาด", "Scrap 10 gears": "แยกเฟือง 10 ตัว", "Reliable": "ไว้ใจได้", "Finish 10 quests": "ทำเควสสำเร็จ 10 ครั้ง", "Quest master": "เจ้าแห่งเควส", "Finish 50 quests": "ทำเควสสำเร็จ 50 ครั้ง",
  "One full week": "ครบหนึ่งสัปดาห์", "Reach a 7-day streak": "เล่นต่อเนื่อง 7 วัน", "Back for more": "กลับมาอีก", "Play 10 runs": "เล่น 10 รอบ", "Regular": "ขาประจำ", "Play 50 runs": "เล่น 50 รอบ", "Well equipped": "พร้อมสรรพ", "Buy 10 Workshop upgrades": "ซื้ออัปเกรด 10 ครั้ง",

  // Screens and buttons
  "Build a gear machine, send soldiers to fight, and beat the bosses.": "สร้างเครื่องจักรเฟือง ส่งทหารไปรบ และเอาชนะบอส", "Play game": "เล่นเกม", "New game (ends this run)": "เกมใหม่ (จบรอบนี้)", "Workshop": "โรงงาน", "Workshop:": "โรงงาน:", "coins": "เหรียญ",
  "Quests & awards": "เควสและรางวัล", "How to play": "วิธีเล่น", "More": "เพิ่มเติม", "Backup": "สำรองข้อมูล", "Guide": "คู่มือ", "Game guide": "คู่มือเกม", "Trophy room": "ห้องถ้วยรางวัล", "Settings": "ตั้งค่า", "Back": "กลับ",
  "Best wave:": "เวฟสูงสุด:", "Wave": "เวฟ", "Bosses beaten": "บอสที่ชนะ", "Soldiers sent": "ทหารที่ส่ง", "Enemies blasted": "ศัตรูที่ระเบิด", "Time": "เวลา", "Overrun!": "ถูกตีแตก!", "New record!": "สถิติใหม่!", "Your army reached wave": "กองทัพของคุณไปถึงเวฟ", "Try again": "ลองอีกครั้ง", "Worlds": "โลก",
  "Paused": "หยุดชั่วคราว", "Resume": "เล่นต่อ", "Restart from wave 1": "เริ่มใหม่จากเวฟ 1", "Got it": "เข้าใจแล้ว", "Choose a world": "เลือกโลก", "Keep going (endless)": "เล่นต่อ (ไม่สิ้นสุด)", "Next world": "โลกถัดไป", "World cleared!": "ผ่านโลกแล้ว!",
  "Daily reward": "รางวัลประจำวัน", "Day streak:": "เล่นต่อเนื่อง:", ". Missing a day won't reset it.": " วัน ขาดหนึ่งวันก็ไม่รีเซ็ต", "Claim": "รับ", "Collect": "รับเหรียญ", "Welcome back!": "ยินดีต้อนรับกลับมา!", "Your machine earned": "เครื่องจักรของคุณหาได้", "coins while you were away.": "เหรียญระหว่างที่คุณไม่อยู่",
  "Progress carries across runs.": "ความคืบหน้าสะสมข้ามรอบ", "quests done so far.": "เควสที่ทำสำเร็จแล้ว", "Today": "วันนี้", "Goals": "เป้าหมาย", "Achievements": "ความสำเร็จ", "coins to spend. Everything here lasts for every run.": "เหรียญให้ใช้ ทุกอย่างที่นี่ใช้ได้ทุกรอบ",
  "Each hit fills connected gears | Full gears pay out | Drag a gear to move or scrap it": "ทุกการกระทบเติมเฟืองที่ต่อกัน | เฟืองเต็มจะส่งทหาร | ลากเฟืองเพื่อย้ายหรือแยก", "Save file": "บันทึกไฟล์", "Copy": "คัดลอก", "Open file": "เปิดไฟล์", "Share your score": "แชร์คะแนน", "Start wave": "เริ่มเวฟ",
  "Rally": "รวมพล", "Overdrive!": "โอเวอร์ไดรฟ์!", "Lightning!": "สายฟ้า!", "No lightning": "ไม่มีสายฟ้า", "Strike now!": "ฟาดเลย!", "STRIKE NOW!": "ฟาดเลย!", "Board full: scrap a gear": "กระดานเต็ม: แยกเฟืองก่อน", "Boss wave!": "เวฟบอส!", "Boss down!": "ล้มบอสแล้ว!", "Boss defeated!": "ชนะบอสแล้ว!", "Victory!": "ชนะ!", "Countered!": "สวนสำเร็จ!",
  "Shield broken!": "โล่แตกแล้ว!", "Shield up! Press Break shield": "ตั้งโล่แล้ว! กด ทำลายโล่", "Rust! Tap the gears": "สนิม! แตะเฟือง", "Rust blocked!": "กันสนิมได้!", "Cells blocked!": "ช่องถูกปิด!", "Scrambled!": "ถูกสลับ!", "Reinforcements!": "กำลังเสริม!", "Sandstorm! Progress lost": "พายุทราย! ความคืบหน้าหาย", "Frozen! Use Lightning to thaw": "แข็ง! ใช้สายฟ้าละลาย", "A gear melted!": "เฟืองละลาย!", "Burned!": "ถูกเผา!", "Ring combo!": "คอมโบวงแหวน!", "Square combo!": "คอมโบสี่เหลี่ยม!", "Line combo!": "คอมโบแถว!",
  "Copied!": "คัดลอกแล้ว!", "Couldn't share": "แชร์ไม่ได้", "Clear the world": "ผ่านโลก", "No Overdrive": "ไม่ใช้โอเวอร์ไดรฟ์", "8 gears or fewer": "เฟืองไม่เกิน 8 ตัว", "Done ✓": "สำเร็จ ✓",
  "Keep this somewhere safe. Restoring it brings back your progress on any device.": "เก็บไว้ในที่ปลอดภัย กู้คืนเพื่อรับความคืบหน้ากลับมาบนอุปกรณ์ใดก็ได้", "Restore from text above": "กู้คืนจากข้อความด้านบน", "Backup file saved.": "บันทึกไฟล์สำรองแล้ว", "Backup copied.": "คัดลอกข้อมูลสำรองแล้ว", "Couldn't copy by itself. Select the text above and copy it.": "คัดลอกเองไม่ได้ เลือกข้อความด้านบนแล้วคัดลอก", "Backup loaded. Tap Restore to use it.": "โหลดข้อมูลสำรองแล้ว แตะ กู้คืน เพื่อใช้", "That isn't a Gear Fight backup. Nothing was changed.": "นี่ไม่ใช่ข้อมูลสำรองของ Gear Fight ไม่มีอะไรเปลี่ยนแปลง", "Tap again to replace your progress": "แตะอีกครั้งเพื่อแทนที่ความคืบหน้า", "Couldn't save on this device. Nothing was changed.": "บันทึกบนอุปกรณ์นี้ไม่ได้ ไม่มีอะไรเปลี่ยนแปลง",
  "Language: English": "ภาษา: English", "Language: Thai": "ภาษา: ไทย",

  // Settings, status and new features
  "Easy mode: on": "โหมดง่าย: เปิด", "Easy mode: off": "โหมดง่าย: ปิด", "Bigger text: on": "ตัวอักษรใหญ่: เปิด", "Bigger text: off": "ตัวอักษรใหญ่: ปิด", "Colour-blind colours: on": "สีสำหรับตาบอดสี: เปิด", "Colour-blind colours: off": "สีสำหรับตาบอดสี: ปิด", "Less motion: on": "ลดการเคลื่อนไหว: เปิด", "Less motion: off": "ลดการเคลื่อนไหว: ปิด",
  "Music: on": "เพลง: เปิด", "Music: off": "เพลง: ปิด", "Vibration: on": "การสั่น: เปิด", "Vibration: off": "การสั่น: ปิด", "Rally ready": "รวมพลอยู่", "Blocking rust": "กันสนิมพร้อม",
  "Gears": "เฟือง", "Abilities": "ความสามารถ", "Rewards": "รางวัล", "Enemies": "ศัตรู", "Bosses": "บอส", "Words to know": "คำศัพท์ควรรู้", "Common": "ทั่วไป",
  "Normal gear": "เฟืองปกติ", "Fills in 4 hits, then sends 1 soldier. Merge two matching gears to level them up.": "เติมครบใน 4 ครั้ง แล้วส่งทหาร 1 นาย รวมเฟืองชนิดเดียวกันเพื่อเพิ่มเลเวล", "Rusted gear": "เฟืองสนิม", "Stops working and blocks the gears behind it. Tap it to fix it.": "หยุดทำงานและขวางเฟืองข้างหลัง แตะเพื่อซ่อม",
  "Main gear": "เฟืองหลัก", "Turns by itself, and its one tooth drives all the gears around it. It can't be moved.": "หมุนเอง ฟันเดียวของมันขับเฟืองรอบ ๆ ทั้งหมด และย้ายไม่ได้",
  "Lightning": "สายฟ้า", "Hits the enemy for free. Press it during a boss's glow, after holding it ready, to cancel the attack. It also thaws freezes.": "โจมตีศัตรูได้ฟรี กดตอนบอสเรืองแสงหลังเก็บไว้พร้อม เพื่อยกเลิกการโจมตี และยังละลายน้ำแข็งได้", "Overdrive": "โอเวอร์ไดรฟ์", "The main gear spins 3x faster for a few seconds, then needs to recharge.": "เฟืองหลักหมุนเร็วขึ้น 3 เท่าสักครู่ แล้วต้องชาร์จใหม่", "Holds arriving soldiers back. When the button says Charge!, press it to charge with 50% more.": "เก็บทหารที่มาถึงไว้ เมื่อปุ่มขึ้นว่า พุ่งชน! ให้กดเพื่อพุ่งชนแรงขึ้น 50%", "Train": "ฝึก", "Moves your army up a rank, so every new soldier counts for more.": "เลื่อนยศกองทัพ ทหารใหม่ทุกนายจะมีค่ามากขึ้น",
  "Goblin runners bring extra enemies, so win quickly.": "ก็อบลินวิ่งเร็วพาศัตรูเพิ่มมา ควรชนะให้ไว", "Soldiers do less, but lightning and bombs hit at full strength.": "ทหารทำดาเมจน้อยลง แต่สายฟ้าและระเบิดแรงเต็มที่", "Keep rusting your gears, so tap them to fix them.": "ทำให้เฟืองเป็นสนิมเรื่อย ๆ แตะเพื่อซ่อม", "Freeze the main gear to half speed. Lightning thaws it.": "แช่แข็งเฟืองหลักให้ช้าลงครึ่งหนึ่ง สายฟ้าละลายได้", "Burn away gear progress, so win fast.": "เผาความคืบหน้าเฟือง จึงควรรีบชนะ",
  "Rank": "ยศ", "How strong each soldier is. Prices count in soldiers of your current rank.": "ความแข็งแกร่งของทหารแต่ละนาย ราคาจะนับตามทหารยศปัจจุบัน", "Merge": "รวมเฟือง", "Drag a gear onto a matching one. Each level pays about 2.5x as much.": "ลากเฟืองไปทับเฟืองชนิดเดียวกัน แต่ละเลเวลส่งทหารมากขึ้นราว 2.5 เท่า", "Combo": "คอมโบ", "Three matching gears in a row, or four in a square, work better. Plain level 1 gears don't count.": "เฟืองเหมือนกัน 3 ตัวเรียงแถว หรือ 4 ตัวเป็นสี่เหลี่ยม จะทำงานดีขึ้น เฟืองปกติเลเวล 1 ไม่นับ", "Chain": "แถวเฟือง", "A line of connected gears. Hits get weaker along it, and a Booster brings them back to full.": "เฟืองที่ต่อกันเป็นแถว แรงหมุนจะอ่อนลงตามแถว และบูสเตอร์คืนแรงให้เต็ม", "Scrap": "แยกเฟือง", "Drag a gear onto the bar that appears to remove it and get some soldiers back.": "ลากเฟืองไปที่แถบที่ปรากฏเพื่อเอาออกและรับทหารคืนบางส่วน",
  "Best wave": "เวฟสูงสุด", "World stars": "ดาวประจำโลก", "Worlds cleared": "โลกที่ผ่าน", "Hardest clear": "ระดับยากสุดที่ผ่าน", "Waves won": "เวฟที่ชนะ", "Attacks countered": "การโจมตีที่สวนได้", "Deals won": "ข้อตกลงที่ชนะ", "Gears merged": "เฟืองที่รวม", "Combos made": "คอมโบที่ทำ", "Daily goals reached": "เป้าหมายรายวันที่สำเร็จ", "Time played": "เวลาที่เล่น", "None yet": "ยังไม่มี", "New: Rally!": "ใหม่: รวมพล!", "New: Training!": "ใหม่: การฝึก!", "New: Rerolls and skips!": "ใหม่: สุ่มใหม่และข้าม!", "New: 2x speed!": "ใหม่: ความเร็ว 2 เท่า!", "New: Risky deals!": "ใหม่: ข้อตกลงเสี่ยง!", "New: Far and Lone gears!": "ใหม่: เฟืองไกลและเฟืองเดี่ยว!", "New: Rare rewards!": "ใหม่: รางวัลหายาก!",
};

// Case doesn't matter, so names drawn in capitals on the canvas are found too.
const TH_TABLE = new Map(Object.entries(TH_WORDS).map(([english, thai]) => [english.toLowerCase(), thai]));

function T(text) {
  return translate(text);
}

function thaiList(text) {
  return text.split(", ").map(T).join(", ");
}

const TH_PATTERNS = [
  [/^Level (\d+) gear$/i, (m) => `เฟืองเลเวล ${m[1]}`],
  [/^(\d+(?:\.\d+)?)s$/, (m) => `${m[1]} วิ`],
  [/^(\d+(?:\.\d+)?)\/s$/, (m) => `${m[1]}/วิ`],
  [/^Combos! With merged/i, () => "คอมโบ! เฟืองที่รวมแล้วหรือเฟืองพิเศษ: 3 ตัวเรียงแถวส่งทหารเพิ่ม 25%, 4 ตัวเป็นสี่เหลี่ยมเติมเร็วขึ้น 25% และบูสเตอร์ที่มีเฟืองครบ 4 ด้านแรงขึ้น 2 เท่า"],
  [/^Achievement: (.+)! \+(\d+)$/i, (m) => `ความสำเร็จ: ${T(m[1])}! +${m[2]}`],
  [/^Daily quest done! \+(\d+) coins$/i, (m) => `เควสรายวันสำเร็จ! +${m[1]} เหรียญ`],
  [/^Quest done! \+(\d+) coins$/i, (m) => `เควสสำเร็จ! +${m[1]} เหรียญ`],
  [/^Daily goal reached! \+(\d+) coins$/i, (m) => `ถึงเป้าหมายรายวัน! +${m[1]} เหรียญ`],
  [/^Deal won! \+(\d+) coins$/i, (m) => `ชนะข้อตกลง! +${m[1]} เหรียญ`],
  [/^Level (\d+)!$/i, (m) => `เลเวล ${m[1]}!`],
  [/^Level (\d+)$/i, (m) => `เลเวล ${m[1]}`],
  [/^Level (\d+) (.+)$/i, (m) => `เลเวล ${m[1]} ${T(m[2])}`],
  [/^(\d+) \/ (\d+) XP$/i, (m) => `${m[1]} / ${m[2]} XP`],
  [/^Day (\d+)$/i, (m) => `วัน ${m[1]}`],
  [/^(\d+) coins$/i, (m) => `${m[1]} เหรียญ`],
  [/^\+(\d+) coins$/i, (m) => `+${m[1]} เหรียญ`],
  [/^\+(\d+) coins, plus (\d+) from quests$/i, (m) => `+${m[1]} เหรียญ และอีก ${m[2]} จากเควส`],
  [/^\+(\d+) XP\. Level (\d+)! \+(\d+) coins$/i, (m) => `+${m[1]} XP เลเวล ${m[2]}! +${m[3]} เหรียญ`],
  [/^\+(\d+) XP\. Level (\d+): (\d+) \/ (\d+)$/i, (m) => `+${m[1]} XP เลเวล ${m[2]}: ${m[3]} / ${m[4]}`],
  [/^Win (\d+) waves$/i, (m) => `ชนะ ${m[1]} เวฟ`],
  [/^Beat (\d+) bosse?s?$/i, (m) => `ชนะบอส ${m[1]} ตัว`],
  [/^Merge gears (\d+) times$/i, (m) => `รวมเฟือง ${m[1]} ครั้ง`],
  [/^Use (\d+) lightning strikes$/i, (m) => `ใช้สายฟ้า ${m[1]} ครั้ง`],
  [/^Blast (\d+) enemies with bombs$/i, (m) => `ระเบิดศัตรู ${m[1]} ตัว`],
  [/^Make (\d+) combos$/i, (m) => `ทำคอมโบ ${m[1]} ครั้ง`],
  [/^Make a level (\d+) gear$/i, (m) => `สร้างเฟืองเลเวล ${m[1]}`],
  [/^Train your army to (.+)$/i, (m) => `ฝึกกองทัพเป็น${T(m[1])}`],
  [/^Reach wave (\d+) without using Overdrive$/i, (m) => `ถึงเวฟ ${m[1]} โดยไม่ใช้โอเวอร์ไดรฟ์`],
  [/^Reach wave (\d+)$/i, (m) => `ถึงเวฟ ${m[1]}`],
  [/^(.+) \(top rank\)$/i, (m) => `${T(m[1])} (ยศสูงสุด)`],
  [/^Train (.+): need (\d+) more$/i, (m) => `ฝึก${T(m[1])}: ต้องการอีก ${m[2]}`],
  [/^Train (.+): (\d+)$/i, (m) => `ฝึก${T(m[1])}: ${m[2]}`],
  [/^Scrapped: \+(\d+)$/i, (m) => `แยกแล้ว: +${m[1]}`],
  [/^Drop here to scrap: \+(\d+)$/i, (m) => `วางที่นี่เพื่อแยก: +${m[1]}`],
  [/^Break shield: (\d+)$/i, (m) => `ทำลายโล่: ${m[1]}`],
  [/^Lightning (\d+)s$/i, (m) => `สายฟ้า ${m[1]} วิ`],
  [/^Overdrive (\d+)s$/i, (m) => `โอเวอร์ไดรฟ์ ${m[1]} วิ`],
  [/^Frozen (\d+)s$/i, (m) => `แข็ง ${m[1]} วิ`],
  [/^Charge! (\d+)$/i, (m) => `พุ่งชน! ${m[1]}`],
  [/^Charge (\d+)%$/i, (m) => `พุ่งชน ${m[1]}%`],
  [/^RALLY (\d+)$/i, (m) => `รวมพล ${m[1]}`],
  [/^SHIELD (\d+)$/i, (m) => `โล่ ${m[1]}`],
  [/^(.+) → (.+) soldiers\/s$/i, (m) => `${m[1]} → ${m[2]} ทหาร/วิ`],
  [/^(.+) soldiers\/s$/i, (m) => `${m[1]} ทหาร/วิ`],
  [/^Next: Final boss, (.+) \((.+)\)$/i, (m) => `ถัดไป: บอสสุดท้าย ${T(m[1])} (${T(m[2])})`],
  [/^Next: (.+), (.+) \((.+)\)$/i, (m) => `ถัดไป: ${T(m[1])}, ${T(m[2])} (${T(m[3])})`],
  [/^Next: (.+) \((.+)\)$/i, (m) => `ถัดไป: ${T(m[1])} (${T(m[2])})`],
  [/^Next: (.+)$/i, (m) => `ถัดไป: ${T(m[1])}`],
  [/^Wave (\d+) won!$/i, (m) => `ชนะเวฟ ${m[1]}!`],
  [/^Wave (\d+)!$/i, (m) => `เวฟ ${m[1]}!`],
  [/^(Risky deal|Deal taken): (.+) next wave, win for \+(\d+) coins$/i, (m) => `${/taken/i.test(m[1]) ? "รับข้อตกลงแล้ว" : "ข้อตกลงเสี่ยง"}: ${T(m[2])} ในเวฟถัดไป ชนะแล้วได้ +${m[3]} เหรียญ`],
  [/^Deal: (.+)$/i, (m) => `ข้อตกลง: ${T(m[1])}`],
  [/^Reroll \((\d+) left\)$/i, (m) => `สุ่มใหม่ (เหลือ ${m[1]})`],
  [/^Skip: \+(\d+) coins$/i, (m) => `ข้าม: +${m[1]} เหรียญ`],
  [/^([★☆]+) New: (.+) \(\+(\d+) coins\)$/, (m) => `${m[1]} ใหม่: ${thaiList(m[2])} (+${m[3]} เหรียญ)`],
  [/^(.+) \((.+)\) cleared!$/i, (m) => `ผ่าน${T(m[1])} (${T(m[2])}) แล้ว!`],
  [/^(.+) cleared!$/i, (m) => `ผ่าน${T(m[1])}แล้ว!`],
  [/^(.+) complete!$/i, (m) => `${T(m[1])} สำเร็จ!`],
  [/^(.+) unlocked!$/i, (m) => `ปลดล็อก${T(m[1])}แล้ว!`],
  [/^Go to (.+)$/i, (m) => `ไปที่${T(m[1])}`],
  [/^(.+): (.+)\. Reach wave (\d+) for (\d+) coins\. Best today: wave (\d+)$/i, (m) => `${T(m[1])}: ${T(m[2])} ถึงเวฟ ${m[3]} รับ ${m[4]} เหรียญ สถิติวันนี้: เวฟ ${m[5]}`],
  [/^(.+): (.+)\. Reach wave (\d+) for (\d+) coins$/i, (m) => `${T(m[1])}: ${T(m[2])} ถึงเวฟ ${m[3]} รับ ${m[4]} เหรียญ`],
  [/^(.+)\. Reach wave (\d+) for (\d+) coins$/i, (m) => `${T(m[1])} ถึงเวฟ ${m[2]} รับ ${m[3]} เหรียญ`],
  [/^Gear Fight! daily challenge (\S+): I reached wave (\d+)\. Can you beat it\? (.+)$/i, (m) => `Gear Fight! ภารกิจรายวัน ${m[1]}: ฉันไปถึงเวฟ ${m[2]} คุณทำได้ไหม? ${m[3]}`],
  [/^This week: (.+)$/i, (m) => `สัปดาห์นี้: ${T(m[1])}`],
  [/^Next star: (.+)$/i, (m) => `ดาวถัดไป: ${T(m[1])}`],
  [/^Treasure! \+(\d+) coins$/i, (m) => `สมบัติ! +${m[1]} เหรียญ`],
  [/^Path won! \+(\d+) coins$/i, (m) => `ผ่านเส้นทางแล้ว! +${m[1]} เหรียญ`],
  [/^\+(\d+) coins$/i, (m) => `+${m[1]} เหรียญ`],
  [/^Tray full: \+(\d+) coins$/i, (m) => `ถาดเต็ม: +${m[1]} เหรียญ`],
  [/^Appear from wave (\d+), (\d+)x as strong\.$/i, (m) => `ปรากฏตั้งแต่เวฟ ${m[1]} แกร่งขึ้น ${m[2]} เท่า`],
  [/^New in the book: (.+)!$/i, (m) => `ใหม่ในสมุด: ${T(m[1])}!`],
  [/^Page complete: (.+)! \+(\d+) coins$/i, (m) => `ครบหน้า: ${T(m[1])}! +${m[2]} เหรียญ`],
  [/^Page complete! \+(\d+) coins earned$/i, (m) => `ครบหน้าแล้ว! ได้รับ +${m[1]} เหรียญ`],
  [/^Complete this page: \+(\d+) coins$/i, (m) => `เก็บครบหน้านี้: +${m[1]} เหรียญ`],
  [/^Collection: (\d+) \/ (\d+)$/i, (m) => `สมุดสะสม: ${m[1]} / ${m[2]}`],
  [/^World (\d+)$/, (m) => `โลก ${m[1]}`],
  [/^Prize: (\d+) coins$/i, (m) => `รางวัล: ${m[1]} เหรียญ`],
  [/^Worlds cleared: (\d+)\/(\d+), stars: (\d+)\/(\d+)$/i, (m) => `ผ่านแล้ว: ${m[1]}/${m[2]} โลก, ดาว: ${m[3]}/${m[4]}`],
  [/^Final boss on wave (\d+)(?:, best wave (\d+))?$/i, (m) => `บอสสุดท้ายเวฟ ${m[1]}${m[2] ? `, ดีที่สุดเวฟ ${m[2]}` : ""}`],
  [/^Locked: clear (.+)$/i, (m) => `ล็อกอยู่: ต้องผ่าน${T(m[1])}`],
  [/^Final boss on wave (\d+)(?:, best wave (\d+))?\. ([★☆]+)(?: Next: (.+))?$/i, (m) => `บอสสุดท้ายเวฟ ${m[1]}${m[2] ? ` เวฟสูงสุด ${m[2]}` : ""} ${m[3]}${m[4] ? ` ถัดไป: ${thaiList(m[4])}` : ""}`],
  [/^Start (.+) at wave (\d+)$/i, (m) => `เริ่ม${T(m[1])}ที่เวฟ ${m[2]}`],
  [/^Rearrange your gears: (\d+)$/i, (m) => `จัดเฟืองใหม่: ${m[1]}`],
  [/^(.+) reached level (\d+)!$/i, (m) => `${T(m[1])} ถึงเลเวล ${m[2]}!`],
  [/^Continue: (.+)$/i, (m) => `เล่นต่อ: ${T(m[1])}`],
  [/^(.+) \((.+)\), wave (\d+)$/i, (m) => `${T(m[1])} (${T(m[2])}) เวฟ ${m[3]}`],
  [/^(.+), wave (\d+)$/i, (m) => `${T(m[1])} เวฟ ${m[2]}`],
  [/^(\d+) waves? to beat your record of (\d+)!$/i, (m) => `อีก ${m[1]} เวฟจะทำลายสถิติ ${m[2]}!`],
  [/^You can afford (.+) in the Workshop!$/i, (m) => `ซื้อ${T(m[1])}ในโรงงานได้แล้ว!`],
  [/^Only (\d+) coins to (.+)$/i, (m) => `อีกแค่ ${m[1]} เหรียญจะได้${T(m[2])}`],
  [/^Quest: (.+) \((\d+)\/(\d+)\)$/i, (m) => `เควส: ${T(m[1])} (${m[2]}/${m[3]})`],
  [/^(\d+) gears?, top level (\d+)$/i, (m) => `เฟือง ${m[1]} ตัว เลเวลสูงสุด ${m[2]}`],
  [/^Rewards: (.+?)(?: \+(\d+) more)?$/i, (m) => `รางวัล: ${thaiList(m[1])}${m[2] ? ` และอีก ${m[2]}` : ""}`],
  [/^This run: (.+)$/i, (m) => `รอบนี้: ${thaiList(m[1])}`],
  [/^\+(\d+) more$/i, (m) => `+อีก ${m[1]}`],
  [/^FINAL BOSS: (.+) (\d+)$/i, (m) => `บอสสุดท้าย: ${T(m[1])} ${m[2]}`],
  [/^(.+)\. Level (\d+) \((\d+)\/(\d+) waves\)$/i, (m) => `${T(m[1])} เลเวล ${m[2]} (${m[3]}/${m[4]} เวฟ)`],
  [/^(.+)\. Level (\d+) \(top\)$/i, (m) => `${T(m[1])} เลเวล ${m[2]} (สูงสุด)`],
  [/^(.+)!$/, (m) => `${T(m[1])}!`],
  [/^(.+) x(\d+)$/i, (m) => `${T(m[1])} x${m[2]}`],
  [/^(.+) (\d+)\/(\d+)$/i, (m) => `${T(m[1])} ${m[2]}/${m[3]}`],
  [/^(.+) (\d+)$/i, (m) => `${T(m[1])} ${m[2]}`],
  [/^(.+): (.+) ✓$/i, (m) => `${T(m[1])}: ${thaiList(m[2])} ✓`],
  [/^(.+): (.+)$/i, (m) => `${T(m[1])}: ${thaiList(m[2])}`],
];

let currentLang = "en";
const translationCache = new Map();
const TRANSLATION_CACHE_MAX = 3000; // numbers in labels make new text forever

function translate(text) {
  const key = text.replace(/\s+/g, " ").trim();
  const exact = TH_TABLE.get(key.toLowerCase());
  if (exact !== undefined) return exact;
  for (const [pattern, build] of TH_PATTERNS) {
    const match = key.match(pattern);
    if (match) return build(match);
  }
  return key;
}

// Translates a piece of text, keeping any spaces around it.
function t(text) {
  if (currentLang !== "th" || typeof text !== "string" || !/[A-Za-z]/.test(text)) return text;
  let result = translationCache.get(text);
  if (result === undefined) {
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    result = lead + translate(text) + trail;
    if (translationCache.size >= TRANSLATION_CACHE_MAX) translationCache.clear();
    translationCache.set(text, result);
  }
  return result;
}

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = t(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === "TEXTAREA") return;
  for (const child of node.childNodes) translateNode(child);
}

// Called once at the start, when the language isn't English. From then on, text
// is translated as it reaches the page or a canvas, whatever put it there.
function installTranslation(root) {
  currentLang = "th";
  document.documentElement.lang = "th";
  translateNode(root);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateNode(record.target);
      else for (const node of record.addedNodes) translateNode(node);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true });
  const proto = CanvasRenderingContext2D.prototype;
  const fill = proto.fillText;
  const stroke = proto.strokeText;
  proto.fillText = function fillTranslated(text, ...rest) { return fill.call(this, t(String(text)), ...rest); };
  proto.strokeText = function strokeTranslated(text, ...rest) { return stroke.call(this, t(String(text)), ...rest); };
}

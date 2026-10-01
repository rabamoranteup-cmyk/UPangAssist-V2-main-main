function getConversationalReply(text) {
  const normalized = (text || "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:]+$/, "")
    .trim();

  if (!normalized) return null;

  // 1. Well-being / "how are you"
  if (
    /^(how\s+(are|r)\s+(you|u|ya)(\s+doing|\s+today)?|how('?s|s|\s+is)\s+it\s+going|how\s+do\s+you\s+do|k[au]musta(\s+ka)?)$/i.test(normalized) ||
    /\bhow (are|r) (you|u)\b/i.test(normalized)
  ) {
    return "I'm doing well, thank you for asking! I am UPangAssist, your virtual campus guide for PHINMA University of Pangasinan. How can I help you today? You can ask me about admissions, enrollment, tuition payments, scholarships, or campus locations.";
  }

  // 2. Greetings
  if (
    /^(hi|hello|hey|hey\s+there|greetings|good\s+day|mabuhay|what'?s\s+up|sup)$/i.test(normalized) ||
    /^(good\s+(morning|afternoon|evening|day))(\s+(upangassist|upang|bot|assistant))?$/i.test(normalized) ||
    /^(hi|hello|hey)\s+(there\s+)?(upangassist|upang|bot|assistant)$/i.test(normalized)
  ) {
    return "Hello! I am UPangAssist, your virtual assistant for PHINMA University of Pangasinan. How can I help you today? Feel free to ask about campus buildings, enrollment, tuition, scholarships, or registrar services.";
  }

  // 3. Identity and capabilities
  if (
    /^(who\s+are\s+you|what\s+is\s+your\s+name|what'?s\s+your\s+name|who\s+made\s+you|what\s+are\s+you|what\s+can\s+you\s+(do|help\s+with)|how\s+can\s+you\s+help(\s+me)?|can\s+you\s+help(\s+me)?|i\s+need\s+help|help(\s+me)?|tell\s+me\s+about\s+yourself|introduce\s+yourself)$/i.test(normalized)
  ) {
    return "I am UPangAssist, an automated student assistant for PHINMA University of Pangasinan (UPang). I can answer your questions regarding campus offices, enrollment guidelines, tuition and payment methods, scholarships, and building navigation.";
  }

  // 4. Gratitude
  if (
    /^(thank\s+you(\s+so\s+much|\s+very\s+much)?|thanks(\s+a\s+lot)?|ty|tysm|salamat(\s+po)?|maraming\s+salamat)$/i.test(normalized)
  ) {
    return "You're very welcome! If you have any more questions about UPang, I'm always here to help. Have a wonderful day!";
  }

  // 5. Farewells
  if (
    /^(bye|goodbye|bye\s+bye|see\s+you(\s+later)?|see\s+ya|cya|good\s*night|take\s+care|paalam)$/i.test(normalized)
  ) {
    return "Goodbye! Have a great day ahead, and don't hesitate to reach out whenever you need information about UPang.";
  }

  // 6. Compliments
  if (
    /^(you('?re|\s+are)\s+(great|awesome|helpful|cool|amazing)|good\s+job|nice\s+one|awesome|cool)$/i.test(normalized)
  ) {
    return "Thank you so much! I'm happy to help. Let me know if there's anything else you need about PHINMA UPang!";
  }

  return null;
}

module.exports = { getConversationalReply };

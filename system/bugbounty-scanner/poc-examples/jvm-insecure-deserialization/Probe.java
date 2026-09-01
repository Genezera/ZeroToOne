import java.io.IOException;
import java.io.Serializable;

// Estágio-de-prova, não um gadget de RCE de verdade: readObject() só
// seta uma flag observável -- suficiente pra provar que o
// desserializador instancia e RODA código de uma classe escolhida pelo
// atacante (o núcleo real do CWE-502), sem executar nenhum payload
// perigoso de verdade (Runtime.exec/ProcessBuilder/etc nunca aparecem
// aqui). Cadeias de gadget reais encadeiam MUITAS classes assim até
// chegar num sink perigoso -- provar esta, sozinha, já é o mínimo
// necessário (mesmo princípio de menor impacto da PoC Solidity/Go).
public class Probe implements Serializable {
    private static final long serialVersionUID = 1L;
    public static volatile boolean triggered = false;

    private void readObject(java.io.ObjectInputStream in) throws IOException, ClassNotFoundException {
        in.defaultReadObject();
        triggered = true;
        System.out.println("Probe.readObject() rodou -- desserializador instanciou uma classe escolhida pelo atacante.");
    }
}

import java.io.ByteArrayOutputStream;
import java.io.ObjectOutputStream;

// PoC completa: monta os bytes exatamente como um atacante faria
// (serializando Probe, uma classe QUALQUER presente no classpath -- o
// ponto é que o desserializador não escolhe, quem manda os bytes
// escolhe), entrega pro sink vulnerável como se tivesse vindo de rede/
// arquivo não confiável, confirma que o efeito colateral rodou.
public class PocMain {
    public static void main(String[] args) throws Exception {
        // "Atacante" monta o payload -- em um ataque real seria uma
        // classe já presente no classpath da vítima com efeito colateral
        // perigoso (gadget chain conhecida); aqui é Probe, deliberadamente
        // inofensiva, só pra provar o mecanismo.
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (ObjectOutputStream out = new ObjectOutputStream(buffer)) {
            out.writeObject(new Probe());
        }
        byte[] attackerControlledBytes = buffer.toByteArray();

        if (Probe.triggered) {
            System.out.println("FAIL: setup inválido -- Probe.triggered já estava true antes da PoC rodar");
            System.exit(1);
        }

        // A "vítima" só recebe bytes -- nunca soube que era um Probe.
        VulnerableDeserializer.deserialize(attackerControlledBytes);

        if (Probe.triggered) {
            System.out.println("PASS: VulnerableDeserializer.deserialize() instanciou e rodou uma classe escolhida pelo atacante a partir de bytes não confiáveis.");
            System.exit(0);
        } else {
            System.out.println("FAIL: Probe não rodou -- desserializador pode ter sido corrigido/filtrado nesta versão.");
            System.exit(1);
        }
    }
}

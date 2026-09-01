import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.ObjectInputStream;

// O padrão exato que heuristics-jvm.mjs::findInsecureDeserialization
// sinaliza: ObjectInputStream sobre bytes não confiáveis, sem
// ObjectInputFilter/allowlist de classe. Isto é o "sink" real -- não
// reimplementado, é literalmente a API padrão do Java usada de forma
// insegura, igual apareceria num achado real.
public class VulnerableDeserializer {
    public static Object deserialize(byte[] untrustedBytes) throws IOException, ClassNotFoundException {
        try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(untrustedBytes))) {
            return in.readObject();
        }
    }
}
